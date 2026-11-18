/** Integration checks for Hydra Config backup & recovery using real bundled Ludusavi and 7-Zip under .tmp/. */
/* global globalThis */
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";

const root = process.cwd();
const base = await fs.mkdtemp(
  path.join(root, ".tmp", "config-backup-integration-")
);
const destination = path.join(base, "backups");
const profileA = path.join(base, "profile-a");
const profileB = path.join(base, "profile-b");
const appData = path.join(base, "appData");

for (const dir of [destination, profileA, profileB, appData]) {
  await fs.mkdir(dir, { recursive: true });
}

function createFakeStore(initialProfile) {
  const dbMap = new Map([
    [
      "userPreferences",
      {
        language: "en",
        downloadsPath: path.join(initialProfile, "Downloads"),
        allowDirectTorrent: false,
        realDebridApiToken: "secret-a",
      },
    ],
    ["language", "en"],
    [
      "ludusaviLocalSettings",
      {
        enabled: true,
        destination,
        fullRetention: 10,
        differentialRetention: 2,
        exitDelaySeconds: 10,
        format: "zip",
        compression: "deflate",
        games: {
          "steam:fixture": {
            enabled: true,
            savePaths: [path.join(initialProfile, "saves")],
            trackingPaths: [],
          },
        },
      },
    ],
    [
      "sourceWebsiteProfiles",
      {
        "site-1": {
          name: "Site One",
          website: "https://example.org",
          searchUrl: "https://example.org/?q={query}",
          approvedDomains: ["example.org"],
        },
      },
    ],
  ]);

  const makeSublevel = (initial = []) => {
    const map = new Map(initial);
    return {
      get: async (k) => map.get(k),
      put: async (k, v) => map.set(k, structuredClone(v)),
      clear: async () => map.clear(),
      batch: async (ops) => {
        for (const op of ops) map.set(op.key, structuredClone(op.value));
      },
      values: () => ({
        all: async () => [...map.values()].map((v) => structuredClone(v)),
      }),
      iterator: () => ({
        all: async () =>
          [...map.entries()].map(([k, v]) => [k, structuredClone(v)]),
      }),
    };
  };

  return {
    profile: initialProfile,
    running: false,
    activeDownload: false,
    events: [],
    dbMap,
    db: {
      get: async (k) => structuredClone(dbMap.get(k)),
      put: async (k, v) => dbMap.set(k, structuredClone(v)),
    },
    gamesSublevel: makeSublevel([
      [
        "steam:fixture",
        {
          title: "Fixture Game",
          shop: "steam",
          objectId: "fixture",
          executablePath: null,
          isDeleted: false,
        },
      ],
    ]),
    downloadSourcesSublevel: makeSublevel([
      [
        "ds-1",
        {
          id: "ds-1",
          name: "Main Feed",
          url: "https://example.org/feed.json",
          status: "ok",
          downloadCount: 5,
          createdAt: "2026-01-01T00:00:00.000Z",
        },
      ],
    ]),
    emulatorsSublevel: makeSublevel(),
    retroarchSublevel: makeSublevel(),
    cloudSaveEmulatorDestinationsSublevel: makeSublevel(),
    themesSublevel: makeSublevel([
      [
        "theme-1",
        {
          id: "theme-1",
          name: "Custom Dark",
          isActive: true,
          code: "body { background: #111; }",
          createdAt: new Date("2026-01-01T00:00:00.000Z"),
          updatedAt: new Date("2026-01-01T00:00:00.000Z"),
        },
      ],
    ]),
    excludedLibraryGamesSublevel: makeSublevel(),
    cloudSaveCustomPathsSublevel: makeSublevel(),
    cloudSaveAutomaticSyncSettingsSublevel: makeSublevel(),
  };
}

globalThis.__cfgTest = {
  root,
  appData,
  state: createFakeStore(profileA),
};

const modules = {
  electron:
    'export const app={isPackaged:false,getAppPath:()=>globalThis.__cfgTest.root,getVersion:()=>"4.4.1-remix.4",getPath:k=>k==="appData"?globalThis.__cfgTest.appData:globalThis.__cfgTest.state.profile};export const Notification={isSupported:()=>false};export const shell={openPath:async()=>""};export const dialog={showErrorBox(){}};',
  i18next: "export const t=k=>k;export default {changeLanguage:async()=>{}};",
  "../level":
    'const wrap=(name)=>({get:(...a)=>globalThis.__cfgTest.state[name].get(...a),put:(...a)=>globalThis.__cfgTest.state[name].put(...a),clear:()=>globalThis.__cfgTest.state[name].clear(),batch:(ops)=>globalThis.__cfgTest.state[name].batch(ops),values:()=>globalThis.__cfgTest.state[name].values(),iterator:()=>globalThis.__cfgTest.state[name].iterator()});export const db=wrap("db");export const gamesSublevel=wrap("gamesSublevel");export const downloadSourcesSublevel=wrap("downloadSourcesSublevel");export const emulatorsSublevel=wrap("emulatorsSublevel");export const retroarchSublevel=wrap("retroarchSublevel");export const cloudSaveEmulatorDestinationsSublevel=wrap("cloudSaveEmulatorDestinationsSublevel");export const themesSublevel=wrap("themesSublevel");export const excludedLibraryGamesSublevel=wrap("excludedLibraryGamesSublevel");export const cloudSaveCustomPathsSublevel=wrap("cloudSaveCustomPathsSublevel");export const cloudSaveAutomaticSyncSettingsSublevel=wrap("cloudSaveAutomaticSyncSettingsSublevel");export const levelKeys={game:(s,i)=>`${s}:${i}`,userPreferences:"userPreferences",language:"language"};',
  "../level/level":
    "export const db={get:(...a)=>globalThis.__cfgTest.state.db.get(...a),put:(...a)=>globalThis.__cfgTest.state.db.put(...a)};",
  "../level/sublevels/games":
    "export const gamesSublevel={get:(...a)=>globalThis.__cfgTest.state.gamesSublevel.get(...a),values:()=>globalThis.__cfgTest.state.gamesSublevel.values()};",
  "../level/sublevels/keys":
    'export const levelKeys={game:(s,i)=>`${s}:${i}`,userPreferences:"userPreferences",language:"language"};',
  "./system-path":
    'export const SystemPath={getPath:k=>k==="appData"?globalThis.__cfgTest.appData:globalThis.__cfgTest.state.profile};',
  "../helpers":
    'import path from "node:path";export const getThemePath=(id,name)=>path.join(globalThis.__cfgTest.state.profile,"themes",name||id);export const getThemeSoundPath=()=>null;',
  "./native-addon":
    'export const NativeAddon={getSystemProcessMap:async()=>({processTree:[{pid:1234,parentPid:1,exe:"C:/Windows/explorer.exe"}]})};',
  "./logger": "export const logger={error(){},warn(){},info(){}};",
  "./window-manager":
    "export const WindowManager={mainWindow:null,sendToAppWindows:(name)=>globalThis.__cfgTest.state.events.push(name)};",
  "./game-running-state":
    "export const hasTrackedGamesRunning=()=>globalThis.__cfgTest.state.running;export const getTrackedGamesRunning=()=>globalThis.__cfgTest.state.running?[{}]:[];",
  "./game-record-updater": "export const updateGameRecord=async()=>{};",
  "../helpers/update-executable-path":
    "export const updateGameExecutablePath=async()=>{};",
  "./download/download-manager":
    "export const DownloadManager={hasActiveDownload:()=>globalThis.__cfgTest.state.activeDownload,applyDownloadSpeedLimit:async()=>{},applyNetworkInterface:async()=>{}};",
  "./wine": "export const Wine={syncUserPreferences(){}};",
  "./screenshot-input":
    "export const ScreenshotInputService={syncUserPreferences(){}};",
  "./gamepad-wake":
    "export const GamepadWakeService={syncUserPreferences(){}};",
  "./big-picture-game-window":
    "export const BigPictureGameWindowService={syncUserPreferences(){}};",
  "./achievement-notification-presenter-electron":
    "export const achievementNotificationPresenter={dispose(){},notifyThemeUpdated(){}};",
  "./torrent-service": "export const setDirectTorrentAccess=async()=>{};",
  "../events/user-preferences/auto-launch":
    "export const applyAutoLaunch=async()=>{};",
  "../events/user-preferences/update-user-preferences":
    "export const withUserPreferencesLock=async(task)=>task();",
};

const bundle = path.join(base, "cfg-service.mjs");
await build({
  stdin: {
    contents:
      'export * from "./src/main/services/hydra-config-backup.ts"; export * from "./src/main/services/ludusavi-local-discovery.ts";',
    resolveDir: root,
  },
  outfile: bundle,
  bundle: true,
  platform: "node",
  format: "esm",
  packages: "external",
  plugins: [
    {
      name: "isolated-cfg-service",
      setup(plugin) {
        plugin.onResolve({ filter: /.*/ }, (args) =>
          Object.hasOwn(modules, args.path)
            ? { path: args.path, namespace: "fixture" }
            : undefined
        );
        plugin.onLoad({ filter: /.*/, namespace: "fixture" }, (args) => ({
          contents: modules[args.path],
          loader: "js",
        }));
      },
    },
  ],
});

const svc = await import(pathToFileURL(bundle).href);

// 1. Back up Profile A's Hydra configuration via real bundled Ludusavi.
const backupRes = await svc.backupHydraConfig(false);
assert.equal(backupRes.status, "success");
assert.ok(backupRes.files >= 8);

// 2. Ensure game backup discovery never exposes the reserved Hydra Config entry.
const discovered = await svc.scanDetectedSaveGames("backups");
assert.equal(
  discovered.some((entry) => entry.title === "Hydra Ludusavi Config"),
  false
);

// 3. Switch to Profile B (simulating a different userData path / fresh install) sharing the same destination.
globalThis.__cfgTest.state = createFakeStore(profileB);
globalThis.__cfgTest.state.dbMap.set("language", "fr");
globalThis.__cfgTest.state.dbMap.set("userPreferences", {
  language: "fr",
  downloadsPath: path.join(profileB, "DifferentDownloads"),
  allowDirectTorrent: false,
  realDebridApiToken: "secret-b-keep",
});
await globalThis.__cfgTest.state.downloadSourcesSublevel.clear();
await globalThis.__cfgTest.state.themesSublevel.clear();

const stateB = await svc.getHydraConfigBackupState();
assert.equal(stateB.versions.length, 1);
const versionName = stateB.versions[0].name;

// 4. Validate archive with bundled 7-Zip.
const validation = await svc.validateHydraConfigBackup(versionName);
assert.match(validation.message, /Validation passed/);

// 5. Preview restore from Profile B (cross-path redirect staging).
const preview = await svc.previewHydraConfigRestore(1, versionName);
assert.equal(preview.sections.length, 7);
assert.ok(preview.sections.find((s) => s.id === "downloadSources")?.hasChanges);

// 6. Confirm restore with sender binding + RESTORE CONFIG phrase.
const restored = await svc.confirmHydraConfigRestore(1, {
  token: preview.token,
  acknowledged: true,
  phrase: "RESTORE CONFIG",
  selection: {
    sections: [
      "preferences",
      "ludusavi",
      "downloadSources",
      "emulators",
      "themes",
      "sourceProfiles",
      "library",
    ],
    overwriteDestination: false,
  },
});
assert.ok(restored.safetySnapshotId);
assert.equal(globalThis.__cfgTest.state.dbMap.get("language"), "en");
assert.equal(
  globalThis.__cfgTest.state.dbMap.get("userPreferences").realDebridApiToken,
  "secret-b-keep"
);
assert.equal(
  (await globalThis.__cfgTest.state.downloadSourcesSublevel.values().all())
    .length,
  1
);
assert.equal(
  (await globalThis.__cfgTest.state.themesSublevel.values().all()).length,
  1
);

// 7. Verify safety snapshot exists and can roll back to Profile B's pre-restore state.
const afterState = await svc.getHydraConfigBackupState();
assert.equal(afterState.safetySnapshots.length, 1);
const snap = afterState.safetySnapshots[0];
const undoPreview = await svc.previewHydraConfigRestore(
  1,
  snap.backup,
  snap.id
);
await svc.confirmHydraConfigRestore(1, {
  token: undoPreview.token,
  acknowledged: true,
  phrase: "RESTORE CONFIG",
  selection: {
    sections: ["preferences", "downloadSources", "themes"],
    overwriteDestination: false,
  },
});
assert.equal(globalThis.__cfgTest.state.dbMap.get("language"), "fr");
assert.equal(
  (await globalThis.__cfgTest.state.downloadSourcesSublevel.values().all())
    .length,
  0
);

// 8. Verify 7-Zip corruption detection rejects a tampered backup archive.
const archivePath = path.join(
  destination,
  "Hydra Ludusavi Config",
  versionName
);
await fs.writeFile(archivePath, "corrupted-zip-data");
await assert.rejects(() => svc.validateHydraConfigBackup(versionName));

await fs.rm(base, { recursive: true, force: true });
console.log("Config backup integration checks passed.");
