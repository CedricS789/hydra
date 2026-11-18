import assert from "node:assert/strict";
import fs from "node:fs";
import { EventEmitter } from "node:events";
import { createRequire } from "node:module";
import { it } from "node:test";
import ts from "typescript";

const require = createRequire(import.meta.url);
function fixture(openError = "", spawnError = false) {
  const child = Object.assign(new EventEmitter(), {
    pid: 42,
    unref() {
      return undefined;
    },
  });
  const stubs: Record<string, unknown> = {
    electron: { shell: { openPath: async () => openError } },
    "node:child_process": {
      spawn: () => {
        queueMicrotask(() =>
          child.emit(spawnError ? "error" : "spawn", new Error("spawn denied"))
        );
        return child;
      },
    },
    "./resolve-launch-command": {
      resolveLaunchCommand: (options: {
        baseCommand: string;
        launchOptions?: string;
      }) => ({
        command: options.baseCommand,
        args: options.launchOptions ? [options.launchOptions] : [],
        env: {},
      }),
    },
    "./windows-batch-command": { isWindowsBatchFile: () => false },
    "@main/services/game-launch-coordinator": {
      GameLaunchCoordinator: class {},
    },
  };
  const source = fs.readFileSync("src/main/helpers/launch-game.ts", "utf8");
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, esModuleInterop: true },
  });
  const exports: Record<string, unknown> = {};
  new Function(
    "exports",
    "require",
    "process",
    outputText + "\nexports.nativeLaunch = launchNatively;"
  )(
    exports,
    (name: string) =>
      stubs[name] ?? (name.startsWith("node:") ? require(name) : {}),
    { ...process, platform: "win32" }
  );
  return exports.nativeLaunch as (
    path: string,
    args?: string
  ) => Promise<number | null>;
}
it("reports shell.openPath failures instead of pretending dispatch succeeded", async () => {
  await assert.rejects(
    fixture("Windows could not open this file")("C:/games/game.exe"),
    /could not open/
  );
  assert.equal(await fixture()("C:/games/game.exe"), null);
});
it("waits for native spawn acceptance and returns its PID", async () => {
  assert.equal(await fixture()("C:/games/game.exe", "--argument"), 42);
});
it("propagates asynchronous native spawn errors to the launch caller", async () => {
  await assert.rejects(
    fixture("", true)("C:/games/game.exe", "--argument"),
    /spawn denied/
  );
});
