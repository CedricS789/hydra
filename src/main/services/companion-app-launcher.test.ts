import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { CompanionApp } from "../../types/companion-app.types";
import {
  CompanionAppLauncher,
  type CompanionAppDependencies,
} from "./companion-app-launcher.ts";

const app = (values: Partial<CompanionApp> = {}): CompanionApp => ({
  id: "utility",
  name: "Utility",
  executablePath: "C:\\Tools\\Utility.exe",
  arguments: "",
  workingDirectory: "",
  enabled: true,
  ...values,
});
function fixture(
  overrides: Partial<CompanionAppDependencies> = {},
  timeout = 500,
  elevatedTimeout = 1000
) {
  const launched: Array<{ app: CompanionApp; args: string[] }> = [];
  const warnings: Array<{ names: string[]; reason: string }> = [];
  const deps: CompanionAppDependencies = {
    platform: "win32",
    getPreferences: async () => ({
      companionAppsEnabled: true,
      companionApps: [app()],
    }),
    listProcesses: async () => [],
    readArguments: async () => [],
    launch: async (app, args) => {
      launched.push({ app, args });
    },
    warn: (names, reason) => {
      warnings.push({ names, reason });
    },
    ...overrides,
  };
  return {
    launcher: new CompanionAppLauncher(deps, timeout, elevatedTimeout),
    launched,
    warnings,
    deps,
  };
}
const deferred = () => {
  let resolve!: () => void;
  const promise = new Promise<void>((yes) => {
    resolve = yes;
  });
  return { promise, resolve };
};

describe("companion app startup", () => {
  it("does nothing for old settings, a disabled feature, empty lists, or unsupported platforms", async () => {
    for (const preferences of [
      null,
      {},
      { companionApps: [app()] },
      { companionAppsEnabled: false, companionApps: [app()] },
      { companionAppsEnabled: true, companionApps: [] },
    ]) {
      const f = fixture({ getPreferences: async () => preferences });
      await f.launcher.startBeforeGame();
      assert.deepEqual(f.launched, []);
      assert.deepEqual(f.warnings, []);
    }
    const f = fixture({ platform: "darwin" });
    await f.launcher.startBeforeGame();
    assert.deepEqual(f.launched, []);
  });

  it("starts enabled apps in order, passes literal arguments and preserves working folders", async () => {
    const first = app({
      arguments: '"C:\\My Scripts\\first.ahk" --flag "" & other',
      workingDirectory: "C:\\My Scripts",
    });
    const last = app({
      id: "last",
      name: "Last",
      executablePath: "C:\\Tools\\Last.exe",
    });
    const f = fixture({
      getPreferences: async () => ({
        companionAppsEnabled: true,
        companionApps: [first, app({ id: "off", enabled: false }), last],
      }),
    });
    await f.launcher.startBeforeGame();
    assert.deepEqual(
      f.launched.map(({ app }) => app.id),
      ["utility", "last"]
    );
    assert.deepEqual(f.launched[0].args, [
      "C:\\My Scripts\\first.ahk",
      "--flag",
      "",
      "&",
      "other",
    ]);
    assert.equal(f.launched[0].app.workingDirectory, "C:\\My Scripts");
  });

  it("matches full paths case-insensitively on Windows, without matching unrelated apps by filename", async () => {
    const f = fixture({
      listProcesses: async () => [{ pid: 1, exe: "c:/tools/UTILITY.EXE" }],
    });
    await f.launcher.startBeforeGame();
    assert.deepEqual(f.launched, []);
    f.deps.listProcesses = async () => [
      { pid: 2, exe: "C:\\Different\\Utility.exe" },
    ];
    await f.launcher.startBeforeGame();
    assert.equal(f.launched.length, 1);
  });

  it("keeps Linux paths case-sensitive", async () => {
    const f = fixture({
      platform: "linux",
      getPreferences: async () => ({
        companionAppsEnabled: true,
        companionApps: [app({ executablePath: "/opt/Tools/utility" })],
      }),
      listProcesses: async () => [{ pid: 1, exe: "/opt/tools/utility" }],
    });
    await f.launcher.startBeforeGame();
    assert.equal(f.launched.length, 1);
  });

  it("distinguishes scripts hosted by the same interpreter and skips an identical command", async () => {
    const f = fixture({
      getPreferences: async () => ({
        companionAppsEnabled: true,
        companionApps: [
          app({ arguments: '"C:\\Scripts\\one.ahk"' }),
          app({ id: "two", arguments: '"C:\\Scripts\\two.ahk"' }),
        ],
      }),
      listProcesses: async () => [{ pid: 1, exe: app().executablePath }],
      readArguments: async () => ["C:\\Scripts\\one.ahk"],
    });
    await f.launcher.startBeforeGame();
    assert.deepEqual(
      f.launched.map(({ app }) => app.id),
      ["two"]
    );
  });

  it("skips an existing command with unreadable arguments and warns without failing", async () => {
    const f = fixture({
      getPreferences: async () => ({
        companionAppsEnabled: true,
        companionApps: [app({ arguments: "script" })],
      }),
      listProcesses: async () => [{ pid: 1, exe: app().executablePath }],
      readArguments: async () => null,
    });
    await f.launcher.startBeforeGame();
    assert.deepEqual(f.launched, []);
    assert.equal(f.warnings[0].reason, "inspection");
  });

  it("coalesces simultaneous game launches and duplicate entries", async () => {
    const gate = deferred();
    let launches = 0;
    const f = fixture({
      getPreferences: async () => ({
        companionAppsEnabled: true,
        companionApps: [app(), app({ id: "duplicate" })],
      }),
      launch: async () => {
        launches++;
        await gate.promise;
      },
    });
    const one = f.launcher.startBeforeGame();
    const two = f.launcher.startBeforeGame();
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(launches, 1);
    gate.resolve();
    await Promise.all([one, two]);
    assert.equal(launches, 1);
  });

  it("rechecks on subsequent launches and starts an app again after it exits", async () => {
    let running = false;
    let launches = 0;
    const f = fixture({
      listProcesses: async () =>
        running ? [{ pid: 1, exe: app().executablePath }] : [],
      launch: async () => {
        running = true;
        launches++;
      },
    });
    await f.launcher.startBeforeGame();
    await f.launcher.startBeforeGame();
    assert.equal(launches, 1);
    running = false;
    await f.launcher.startBeforeGame();
    assert.equal(launches, 2);
  });

  it("continues after a missing executable, denied startup, or failed inspection", async () => {
    const f = fixture({
      getPreferences: async () => ({
        companionAppsEnabled: true,
        companionApps: [
          app(),
          app({
            id: "next",
            name: "Next",
            executablePath: "C:\\Tools\\Next.exe",
          }),
        ],
      }),
      launch: async (entry) => {
        if (entry.id === "utility") throw new Error("private arguments");
        f.launched.push({ app: entry, args: [] });
      },
    });
    await f.launcher.startBeforeGame();
    assert.deepEqual(
      f.launched.map(({ app }) => app.id),
      ["next"]
    );
    assert.deepEqual(f.warnings, [{ names: ["Utility"], reason: "failed" }]);
    f.deps.listProcesses = async () => {
      throw new Error("inspection failed");
    };
    await assert.doesNotReject(f.launcher.startBeforeGame());
  });

  it("bounds preparation and never starts a late app after the game has continued", async () => {
    const gate = deferred();
    const f = fixture(
      {
        listProcesses: async () => {
          await gate.promise;
          return [];
        },
      },
      20
    );
    await f.launcher.startBeforeGame();
    assert.equal(f.warnings[0].reason, "timeout");
    gate.resolve();
    await new Promise((resolve) => setImmediate(resolve));
    assert.deepEqual(f.launched, []);
  });

  it("extends timeout for interactive UAC elevation prompts and bounds the extended window", async () => {
    const f = fixture(
      {
        launch: async (entry, args, _signal, requestInteractiveTimeout) => {
          requestInteractiveTimeout?.();
          await new Promise((resolve) => setTimeout(resolve, 45));
          f.launched.push({ app: entry, args });
        },
      },
      20,
      150
    );
    await f.launcher.startBeforeGame();
    assert.equal(f.launched.length, 1);
    assert.deepEqual(f.warnings, []);

    const expired = fixture(
      {
        launch: async (entry, args, signal, requestInteractiveTimeout) => {
          requestInteractiveTimeout?.();
          await new Promise<void>((resolve) => {
            signal.addEventListener("abort", () => resolve(), { once: true });
          });
          if (!signal.aborted) expired.launched.push({ app: entry, args });
        },
      },
      15,
      40
    );
    await expired.launcher.startBeforeGame();
    assert.equal(expired.warnings[0].reason, "timeout");
    assert.deepEqual(expired.launched, []);
  });

  it("tolerates invalid stored configuration without launching anything", async () => {
    const f = fixture({
      getPreferences: async () => ({
        companionAppsEnabled: true,
        companionApps: [app({ executablePath: "relative.exe" })],
      }),
    });
    await f.launcher.startBeforeGame();
    assert.deepEqual(f.launched, []);
    assert.equal(f.warnings[0].reason, "invalid");
  });
});
