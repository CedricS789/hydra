import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import fs from "node:fs";
import { createRequire } from "node:module";
import { it } from "node:test";
import ts from "typescript";
import { dispatchSteamProtocolLaunch } from "../services/steam-integration/steam-protocol-launch-dispatch.ts";

const require = createRequire(import.meta.url);
function load(file: string, stubs: Record<string, unknown>, appended = "") {
  const source = fs
    .readFileSync(file, "utf8")
    .replace(
      "const LAUNCH_DELAY_IN_MS = 2_000",
      "const LAUNCH_DELAY_IN_MS = 0"
    );
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      esModuleInterop: true,
    },
  });
  const exports: Record<string, (...args: unknown[]) => Promise<unknown>> = {};
  new Function("exports", "require", "process", outputText + appended)(
    exports,
    (name: string) =>
      stubs[name] ?? (name.startsWith("node:") ? require(name) : {}),
    { ...process, platform: "win32" }
  );
  return exports;
}

function fixture(
  options: {
    blocked?: boolean;
    missing?: boolean;
    steam?: boolean;
    steamFails?: boolean;
    epic?: boolean;
  } = {}
) {
  const calls: string[] = [];
  const noop = () => {};
  const game = options.epic ? { epicInstallation: {} } : null;
  const service = {
    assertSessionCurrent: noop,
    runLaunchGate: async (_id: string, run: () => Promise<unknown>) => run(),
  };
  const cloud = {
    clearCloudSaveLaunchGuard: noop,
    setCloudSaveLaunchGuard: noop,
    canRunAutomaticCloudSaveSync: async () => {
      calls.push("checks");
      return options.blocked ?? false;
    },
    getCloudSaveGameContext: async () => null,
    runAutomaticCloudSaveSyncDetailed: async () => ({
      status: "failed",
      result: null,
    }),
    shouldBlockGameLaunchForCloudSave: () => options.blocked ?? false,
  };
  const stubs: Record<string, unknown> = {
    electron: {
      shell: {
        openPath: async () => {
          calls.push("game");
          return "";
        },
        openExternal: async () => {
          calls.push("steam");
          if (options.steamFails) throw new Error("Steam unavailable");
        },
      },
    },
    "node:fs": { existsSync: () => !options.missing },
    "node:child_process": {
      spawn: () => {
        calls.push("game");
        const child = Object.assign(new EventEmitter(), {
          pid: 42,
          unref: noop,
        });
        queueMicrotask(() => child.emit("spawn"));
        return child;
      },
    },
    "@main/level": {
      levelKeys: { game: () => "steam:1", userPreferences: "preferences" },
      gamesSublevel: { get: async () => game },
      db: { get: async () => ({}) },
    },
    "@main/services": {
      logger: { info: noop, warn: noop, error: noop, log: noop },
      WindowManager: {
        createGameLauncherWindow: async () => {},
        closeGameLauncherWindow: noop,
        sendToAppWindows: noop,
      },
      launchedGamePids: new Map(),
    },
    "@main/services/cloud-save": cloud,
    "@main/services/game-launch-coordinator": {
      GameLaunchCoordinator: class {},
    },
    "@main/services/game-record-updater": {
      updateGameRecord: async () => game,
    },
    "@main/services/game-launcher-status": { sendGameLauncherStatus: noop },
    "@main/services/common-redist-manager": {
      CommonRedistManager: { runPreflight: async () => {} },
    },
    "@main/services/companion-apps": {
      startCompanionAppsBeforeGame: async () => {
        calls.push("companion");
      },
    },
    "@main/services/steam-integration/steam-protocol-launch": {
      resolveSteamProtocolLaunch: async () =>
        options.steam
          ? { url: "steam://run/1", compatibilityPrefixPath: "" }
          : null,
    },
    "@main/services/steam-integration/steam-protocol-launch-dispatch": {
      dispatchSteamProtocolLaunch,
    },
    "@main/services/epic/cloud-saves": {
      getEpicCloudSaveService: () => service,
    },
    "@main/services/epic/launch": {
      prepareManagedEpicLaunch: async (
        _game: unknown,
        _path: string,
        opts: { beforeSaveSync: () => Promise<void> }
      ) => {
        await opts.beforeSaveSync();
        return {
          session: {},
          parameters: {
            executable: "C:/Games/game.exe",
            args: [],
            workingDirectory: "C:/Games",
            environment: {},
          },
        };
      },
      markManagedEpicLaunched: async () => {},
      recordManagedEpicProcess: noop,
    },
    "../events/helpers/parse-executable-path": {
      parseExecutablePath: (value: string) => value,
      readExecutableShortcut: () => null,
    },
    "./resolve-launch-command": {
      resolveLaunchCommand: ({ baseCommand }: { baseCommand: string }) => ({
        command: baseCommand,
        args: [],
        env: {},
      }),
    },
    "./windows-batch-command": { isWindowsBatchFile: () => false },
  };
  const module = load(
    "src/main/helpers/launch-game.ts",
    stubs,
    "\nexports.invoke = validateAndLaunchGame;"
  );
  return {
    calls,
    run: () =>
      module.invoke({
        shop: options.epic ? "epic" : "steam",
        objectId: "1",
        executablePath: "C:/Games/game.exe",
      }),
  };
}

it("normal launch completes checks before companions and dispatches the game afterward", async () => {
  const f = fixture();
  await f.run();
  assert.deepEqual(f.calls, ["checks", "companion", "game"]);
});
it("missing executable and blocked save checks never start companion apps", async () => {
  const missing = fixture({ missing: true });
  await assert.rejects(missing.run(), /game_executable_not_found/);
  assert.deepEqual(missing.calls, []);
  const blocked = fixture({ blocked: true });
  await blocked.run();
  assert.deepEqual(blocked.calls, ["checks"]);
});
it("Steam protocol and its native fallback start companions exactly once", async () => {
  for (const steamFails of [false, true]) {
    const f = fixture({ steam: true, steamFails });
    await f.run();
    assert.deepEqual(
      f.calls,
      steamFails
        ? ["checks", "companion", "steam", "game"]
        : ["checks", "companion", "steam"]
    );
  }
});
it("managed Epic launches start companions after their save gate and before spawn", async () => {
  const f = fixture({ epic: true });
  await f.run();
  assert.deepEqual(f.calls, ["checks", "companion", "game"]);
  const blocked = fixture({ epic: true, blocked: true });
  await blocked.run();
  assert.deepEqual(blocked.calls, ["checks"]);
});

for (const retroarch of [false, true]) {
  it(`${retroarch ? "RetroArch" : "Classics"} starts companions only after emulator validation`, async () => {
    const calls: string[] = [];
    let configured = true;
    const config = {
      executablePath: "C:/Tools/emulator.exe",
      binary: "dolphin",
      cores: { core: { installed: true, path: "C:/Tools/core.dll" } },
    };
    const stubs = {
      "node:fs": { existsSync: () => configured },
      "@main/level": {
        levelKeys: { game: () => "launchbox:1" },
        gamesSublevel: { get: async () => null },
        db: { get: async () => null },
      },
      "@main/services": {
        emulators: {
          getEmulatorConfig: async () => config,
          resolveEmulatorExecutableTarget: (value: string) => value,
        },
        retroarch: {
          getRetroArchConfig: async () => config,
          PLATFORM_TO_CORE: { snes: "core" },
        },
        logger: { error: () => {} },
      },
      "./flatpak-emulator-launch": {
        findFlatpakCommand: () => null,
        resolveFlatpakEmulatorLaunch: () => null,
      },
      "./resolve-launch-command": {
        resolveLaunchCommand: () => ({
          command: "emulator",
          args: [],
          env: {},
        }),
      },
      "./launch-classics-game": { resolveEmulatorWrappers: () => [] },
      "@main/services/companion-apps": {
        startCompanionAppsBeforeGame: async () => {
          calls.push("companion");
        },
      },
      "./spawn-detached-emulator": {
        spawnDetachedEmulator: async () => {
          calls.push("emulator");
          return { unref: () => {} };
        },
      },
    };
    const module = load(
      `src/main/helpers/${retroarch ? "launch-retroarch-game" : "launch-classics-game"}.ts`,
      stubs
    );
    const run = () =>
      (retroarch ? module.launchRetroArchGame : module.launchClassicsGame)({
        shop: "launchbox",
        objectId: "1",
        discPath: "C:/Games/game.iso",
        romPath: "C:/Games/game.rom",
        platform: "snes",
        system: "wii",
      });
    await run();
    assert.deepEqual(calls, ["companion", "emulator"]);
    configured = false;
    calls.length = 0;
    await assert.rejects(run());
    assert.deepEqual(calls, []);
  });
}
