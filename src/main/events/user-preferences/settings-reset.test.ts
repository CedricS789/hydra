/* eslint-disable @typescript-eslint/no-explicit-any -- Synthetic IPC bridge and deliberately partial storage fixtures. */
import assert from "node:assert/strict";
import fs from "node:fs";
import ts from "typescript";
import { it } from "node:test";
import { SettingsResetEngine } from "../../services/settings-reset-engine.ts";
import { LudusaviBackupQueue } from "../../services/ludusavi-local-queue.ts";
import * as registry from "../../../shared/settings-reset.ts";
import { validateDirectTorrentChange } from "../../../shared/direct-torrent-policy.ts";

function fixture() {
  const store = new Map<string, unknown>([
    [
      "userPreferences",
      {
        language: "fr",
        runAtStartup: true,
        realDebridApiToken: "keep-secret",
        enableAutoInstall: true,
      },
    ],
    [
      "ludusaviLocalSettings",
      {
        ...registry.BACKUP_BEHAVIOR_DEFAULTS,
        enabled: false,
        destination: "C:/backups-to-preserve",
        games: {
          "steam:1": {
            enabled: false,
            savePaths: ["C:/custom"],
            trackingPaths: ["C:/game.exe"],
            manifestTitle: "Linked title",
            steamId: "99",
          },
          "steam:2": {
            enabled: false,
            savePaths: ["C:/other"],
            trackingPaths: [],
          },
        },
      },
    ],
  ]);
  const themes = [{ id: "theme1", isActive: true, code: "keep-the-css" }];
  const handlers = new Map<string, (...args: any[]) => Promise<any>>();
  const events: string[] = [];
  const queue = new LudusaviBackupQueue();
  let running = false,
    scans = 0,
    preferenceWrites = 0;
  const games = new Map([
    ["steam:1", { title: "First game", shop: "steam", objectId: "1" }],
    ["steam:2", { title: "Other game", shop: "steam", objectId: "2" }],
  ]);
  const clone = <T>(value: T) => structuredClone(value);
  const stubs: Record<string, unknown> = {
    "@main/level": {
      db: {
        get: async (key: string) => clone(store.get(key)),
        put: async (key: string, value: unknown) => {
          store.set(key, clone(value));
        },
      },
      gamesSublevel: {
        get: async (key: string) => clone(games.get(key)),
        values: () => ({ all: async () => [...games.values()] }),
      },
      themesSublevel: {
        values: () => ({ all: async () => clone(themes) }),
        batch: async (
          changes: { key: string; value: (typeof themes)[number] }[]
        ) => {
          changes.forEach((change) =>
            Object.assign(
              themes.find((theme) => theme.id === change.key)!,
              change.value
            )
          );
        },
      },
      levelKeys: { userPreferences: "userPreferences" },
    },
    "@main/services/window-manager": {
      WindowManager: { sendToAppWindows: (name: string) => events.push(name) },
    },
    "@main/services": {
      achievementNotificationPresenter: { notifyThemeUpdated: () => undefined },
    },
    "@main/services/game-running-state": {
      hasTrackedGamesRunning: () => running,
    },
    "@main/services/ludusavi-local": {
      getLudusaviLocalSettings: async () =>
        clone(store.get("ludusaviLocalSettings")),
      persistLudusaviLocalSettings: async (value: {
        destination: string;
        enabled: boolean;
      }) => {
        assert.equal(value.destination, "C:/backups-to-preserve");
        assert.equal(typeof value.enabled, "boolean");
        store.set("ludusaviLocalSettings", clone(value));
      },
      localSaveTools: {
        queue,
        assertStopped: async () => {
          if (running) throw Error("game running");
        },
      },
    },
    "@main/services/native-addon": {
      NativeAddon: {
        getSystemProcessMap: async () => {
          scans++;
          return { processTree: [{ exe: "C:/unrelated.exe" }] };
        },
      },
    },
    "@main/services/ludusavi-local-lock": {
      acquireSaveBackupLock: async () => ({ release: async () => undefined }),
    },
    "@main/services/settings-reset-engine": { SettingsResetEngine },
    "../../../shared/settings-reset": registry,
    "../register-event": {
      registerEvent: (
        name: string,
        handler: (...args: any[]) => Promise<any>
      ) => handlers.set(name, handler),
    },
    "./update-user-preferences": {
      withUserPreferencesLock: async (task: () => Promise<unknown>) => task(),
      applyUserPreferences: async (
        _event: unknown,
        patch: Record<string, unknown>,
        confirmation?: string
      ) => {
        const current = store.get("userPreferences") as object;
        validateDirectTorrentChange(current, patch, confirmation);
        store.set("userPreferences", { ...current, ...clone(patch) });
        preferenceWrites++;
      },
    },
  };
  const output = ts.transpileModule(
    fs.readFileSync(
      "src/main/events/user-preferences/settings-reset.ts",
      "utf8"
    ),
    { compilerOptions: { module: ts.ModuleKind.CommonJS } }
  ).outputText;
  new Function("exports", "require", output)({}, (name: string) => {
    assert.ok(Object.hasOwn(stubs, name), name);
    return stubs[name];
  });
  const call = (name: string, ...args: unknown[]) =>
    handlers.get(name)!({ sender: { id: 1 } }, ...args);
  return {
    store,
    themes,
    events,
    queue,
    call,
    running: () => {
      running = true;
    },
    scans: () => scans,
    preferenceWrites: () => preferenceWrites,
  };
}
it("validates backend reset targets and preserves unrelated preferences", async () => {
  const f = fixture();
  await assert.rejects(
    async () => f.call("getSettingsResetStatus", { group: "unknown" }),
    /Unknown reset group/
  );
  await assert.rejects(
    async () =>
      f.call("getSettingsResetStatus", {
        group: "general",
        gameKey: "steam:1",
      }),
    /only valid/
  );
  const review = await f.call(
    "previewSettingsReset",
    { group: "general" },
    false
  );
  await f.call("applySettingsReset", review.token, false, "");
  const preferences = f.store.get("userPreferences") as Record<string, unknown>;
  assert.equal(preferences.runAtStartup, false);
  assert.equal(preferences.language, "fr");
  assert.equal(preferences.realDebridApiToken, "keep-secret");
  assert.equal(preferences.enableAutoInstall, true);
});
it("resets backup behavior and only the selected game's rules without changing destination, other games or advanced files", async () => {
  const f = fixture();
  const before = structuredClone(f.store.get("ludusaviLocalSettings")) as any;
  let review = await f.call(
    "previewSettingsReset",
    { group: "backups" },
    false
  );
  await f.call("applySettingsReset", review.token, true, "RESET SETTINGS");
  const after = f.store.get("ludusaviLocalSettings") as any;
  assert.equal(after.enabled, true);
  assert.equal(after.destination, before.destination);
  assert.deepEqual(after.games, before.games);
  review = await f.call(
    "previewSettingsReset",
    { group: "gameRules", gameKey: "steam:1" },
    false
  );
  assert.ok(
    review.warnings.some((warning: string) => warning.includes("First game"))
  );
  await f.call("applySettingsReset", review.token, true, "RESET SETTINGS");
  const next = f.store.get("ludusaviLocalSettings") as any;
  assert.deepEqual(next.games["steam:1"], registry.GAME_RULE_DEFAULTS);
  assert.deepEqual(next.games["steam:2"], before.games["steam:2"]);
  assert.equal(f.preferenceWrites(), 0);
  assert.equal(f.scans(), 2);
  review = await f.call(
    "previewSettingsReset",
    { group: "gameRules", gameKey: "steam:1" },
    true
  );
  await f.call("applySettingsReset", review.token, true, "RESTORE SETTINGS");
  assert.deepEqual(
    (f.store.get("ludusaviLocalSettings") as any).games,
    before.games
  );
});
it("refuses backup changes while a game runs or another save operation is queued", async () => {
  const f = fixture();
  let release!: () => void;
  const waiting = f.queue.enqueue(
    "full-manager",
    () =>
      new Promise<void>((resolve) => {
        release = resolve;
      })
  );
  await Promise.resolve();
  await assert.rejects(
    f.call("previewSettingsReset", { group: "backups" }, false),
    /Stop running games/
  );
  release();
  await waiting;
  await Promise.resolve();
  f.running();
  await assert.rejects(
    f.call("previewSettingsReset", { group: "backups" }, false),
    /Stop running games/
  );
});
it("deactivates themes without deleting them and safely recovers active theme selection", async () => {
  const f = fixture();
  let review = await f.call(
    "previewSettingsReset",
    { group: "appearance" },
    false
  );
  await f.call("applySettingsReset", review.token, false, "");
  assert.equal(f.themes[0].isActive, false);
  assert.equal(f.themes[0].code, "keep-the-css");
  assert.ok(f.events.includes("on-custom-theme-updated"));
  review = await f.call("previewSettingsReset", { group: "appearance" }, true);
  await f.call("applySettingsReset", review.token, false, "");
  assert.equal(f.themes[0].isActive, true);
});
