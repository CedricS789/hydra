import assert from "node:assert/strict";
import { execFile, spawn, type ChildProcess } from "node:child_process";
import { EventEmitter, once } from "node:events";
import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { it } from "node:test";
import ts from "typescript";
import type { CompanionAppDependencies } from "./companion-app-launcher";
import {
  parseWindowsCommandLine,
  quoteWindowsArguments,
  validateCompanionApps,
} from "../../shared/companion-apps.js";

const require = createRequire(import.meta.url);
function fixture(
  platform: NodeJS.Platform = process.platform,
  processes = [
    {
      pid: process.pid,
      exe: process.execPath,
      environ: {} as Record<string, string>,
    },
  ],
  overrides: {
    execFile?: typeof execFile;
    spawn?: typeof spawn;
  } = {}
) {
  let dependencies!: CompanionAppDependencies;
  const children: ChildProcess[] = [];
  const stubs: Record<string, unknown> = {
    electron: { Notification: { isSupported: () => false } },
    i18next: { t: (key: string) => key },
    "@main/level": { db: { get: async () => null }, levelKeys: {} },
    "./native-addon": {
      NativeAddon: {
        listProcesses: async () => processes,
      },
    },
    "./logger": { logger: { warn: () => {} } },
    "./window-manager": { WindowManager: { sendToAppWindows: () => {} } },
    "./companion-app-launcher": {
      CompanionAppLauncher: class {
        constructor(deps: CompanionAppDependencies) {
          dependencies = deps;
        }
      },
    },
    "../../shared/companion-apps": {
      parseWindowsCommandLine,
      quoteWindowsArguments,
      validateCompanionApps,
    },
    "node:child_process": {
      execFile: overrides.execFile ?? execFile,
      spawn:
        overrides.spawn ??
        ((...args: Parameters<typeof spawn>) => {
          const child = spawn(...args);
          children.push(child);
          return child;
        }),
    },
  };
  const source = fs.readFileSync("src/main/services/companion-apps.ts", "utf8");
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, esModuleInterop: true },
  });
  new Function("exports", "require", "process", outputText)(
    {},
    (name: string) => stubs[name] ?? require(name),
    { ...process, platform }
  );
  return { dependencies, children };
}

it("native companion adapter starts an executable with literal arguments and the chosen working folder", async () => {
  const f = fixture();
  const directory = path.resolve(".tmp/companion-runtime");
  fs.mkdirSync(directory, { recursive: true });
  const output = path.join(directory, "child.json");
  fs.rmSync(output, { force: true });
  const args = [
    "-e",
    `require('node:fs').writeFileSync(${JSON.stringify(output)}, JSON.stringify({args:process.argv.slice(1),cwd:process.cwd()}))`,
    "--",
    "&",
    "literal argument",
  ];
  try {
    await f.dependencies.launch(
      {
        id: "test",
        name: "Test utility",
        executablePath: process.execPath,
        arguments: "",
        workingDirectory: directory,
        enabled: true,
      },
      args,
      new AbortController().signal
    );
    const [code] = await once(f.children[0], "exit");
    assert.equal(code, 0);
    const result = JSON.parse(fs.readFileSync(output, "utf8"));
    assert.deepEqual(result.args, ["&", "literal argument"]);
    assert.equal(result.cwd.toLowerCase(), directory.toLowerCase());
  } finally {
    for (const child of f.children) if (child.exitCode === null) child.kill();
    fs.rmSync(output, { force: true });
  }
});

it("Linux companion detection retains the original path of a running AppImage", async () => {
  const { dependencies } = fixture("linux", [
    {
      pid: 123,
      exe: "/tmp/.mount_utility/AppRun",
      environ: { APPIMAGE: "/home/user/Utility.AppImage" },
    },
  ]);
  assert.deepEqual(await dependencies.listProcesses(), [
    { pid: 123, exe: "/tmp/.mount_utility/AppRun" },
    { pid: 123, exe: "/home/user/Utility.AppImage" },
  ]);
});

it("native companion adapter rejects missing files and non-native Windows scripts", async () => {
  const { dependencies, children } = fixture();
  const app = {
    id: "test",
    name: "Missing",
    executablePath: path.resolve(".tmp/nonexistent-companion.exe"),
    arguments: "",
    workingDirectory: "",
    enabled: true,
  };
  await assert.rejects(
    dependencies.launch(app, [], new AbortController().signal)
  );
  if (process.platform === "win32")
    await assert.rejects(
      dependencies.launch(
        { ...app, executablePath: "C:\\Tools\\script.bat" },
        [],
        new AbortController().signal
      ),
      /not_native/
    );
  assert.equal(children.length, 0);
});

it(
  "Windows companion inspection reads a real script command without launching a visible shell",
  { skip: process.platform !== "win32" },
  async () => {
    const { dependencies } = fixture();
    const args = [
      "-e",
      "setInterval(()=>{},1000)",
      "--",
      "script with spaces.ahk",
      "&",
    ];
    const child = spawn(process.execPath, args, {
      windowsHide: true,
      stdio: "ignore",
    });
    await once(child, "spawn");
    try {
      const result = await dependencies.readArguments(
        { pid: child.pid!, exe: process.execPath },
        AbortSignal.timeout(5_000)
      );
      assert.deepEqual(result, args);
    } finally {
      child.kill();
      await once(child, "exit");
    }
  }
);

it("Windows companion adapter falls back to elevated ShellExecute on EACCES/UNKNOWN and respects runAsAdmin", async () => {
  const directory = path.resolve(".tmp/companion-elevation");
  fs.mkdirSync(directory, { recursive: true });
  const exePath = path.join(directory, "ElevatedTool.exe");
  fs.writeFileSync(exePath, "");
  try {
    let spawnCalls = 0;
    const elevatedCalls: Array<{
      file: string;
      env: Record<string, string | undefined>;
    }> = [];
    let spawnErrorCode: string | null = "EACCES";
    let execFileShouldFail = false;

    const { dependencies } = fixture("win32", [], {
      spawn: (() => {
        spawnCalls++;
        const child = Object.assign(new EventEmitter(), {
          unref: () => {},
        }) as unknown as ChildProcess;
        queueMicrotask(() => {
          if (spawnErrorCode) {
            child.emit(
              "error",
              Object.assign(new Error("spawn failed"), {
                code: spawnErrorCode,
              })
            );
          } else {
            child.emit("spawn");
          }
        });
        return child;
      }) as typeof spawn,
      execFile: ((
        file: string,
        _args: string[],
        options: { env?: Record<string, string | undefined> },
        callback: (err: Error | null, stdout: string, stderr: string) => void
      ) => {
        elevatedCalls.push({ file, env: options.env ?? {} });
        queueMicrotask(() =>
          callback(
            execFileShouldFail ? new Error("UAC declined") : null,
            "",
            ""
          )
        );
        return {} as ChildProcess;
      }) as unknown as typeof execFile,
    });

    const baseApp = {
      id: "elevated",
      name: "Elevated Tool",
      executablePath: exePath,
      arguments: "",
      workingDirectory: directory,
      enabled: true,
    };

    let interactiveRequested = 0;
    await dependencies.launch(
      baseApp,
      ["--flag", "value with spaces"],
      new AbortController().signal,
      () => {
        interactiveRequested++;
      }
    );
    assert.equal(spawnCalls, 1);
    assert.equal(elevatedCalls.length, 1);
    assert.equal(interactiveRequested, 1);
    assert.match(elevatedCalls[0].file, /powershell\.exe$/i);
    assert.equal(elevatedCalls[0].env.HYDRA_COMPANION_PATH, exePath);
    assert.equal(
      elevatedCalls[0].env.HYDRA_COMPANION_ARGS,
      '--flag "value with spaces"'
    );
    assert.equal(elevatedCalls[0].env.HYDRA_COMPANION_CWD, directory);

    spawnErrorCode = "UNKNOWN";
    await dependencies.launch(baseApp, [], new AbortController().signal);
    assert.equal(spawnCalls, 2);
    assert.equal(elevatedCalls.length, 2);

    await dependencies.launch(
      { ...baseApp, runAsAdmin: true },
      [],
      new AbortController().signal,
      () => {
        interactiveRequested++;
      }
    );
    assert.equal(spawnCalls, 2);
    assert.equal(elevatedCalls.length, 3);
    assert.equal(interactiveRequested, 2);

    execFileShouldFail = true;
    await assert.rejects(
      dependencies.launch(
        { ...baseApp, runAsAdmin: true },
        [],
        new AbortController().signal
      ),
      /companion_app_spawn_failed/
    );

    execFileShouldFail = false;
    spawnErrorCode = "ENOENT";
    await assert.rejects(
      dependencies.launch(baseApp, [], new AbortController().signal),
      /companion_app_spawn_failed/
    );
    assert.equal(elevatedCalls.length, 4);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
