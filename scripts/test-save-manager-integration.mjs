/** Integration checks use only synthetic files and an isolated profile under .tmp/.
 * Prepare bundled Ludusavi first with scripts/postinstall.cjs.
 * Optional: --rclone <exe> adds transfers to a local filesystem remote.
 */
/* global globalThis */
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { build } from "esbuild";
import YAML from "yaml";

const execute = promisify(execFile),
  root = process.cwd();
const base = await fs.mkdtemp(
  path.join(root, ".tmp", "full-save-integration-")
);
const source = path.join(base, "live-fixture"),
  destination = path.join(base, "backups");
const profile = path.join(base, "profile"),
  standalone = path.join(base, "appData", "ludusavi");
for (const folder of [source, destination, profile, standalone])
  await fs.mkdir(folder, { recursive: true });
const game = {
  title: "Hydra save manager fixture",
  shop: "steam",
  objectId: "fixture",
  executablePath: path.join(source, "game.exe"),
  isDeleted: false,
};
const key = "steam:fixture";
const settings = {
  enabled: false,
  destination,
  fullRetention: 10,
  differentialRetention: 2,
  format: "zip",
  compression: "deflate",
  exitDelaySeconds: 10,
  games: { [key]: { enabled: true, savePaths: [source], trackingPaths: [] } },
};
const store = new Map([["ludusaviLocalSettings", settings]]);
await fs.writeFile(
  path.join(standalone, "config.yaml"),
  YAML.stringify({
    manifest: { enable: false },
    roots: [],
    customGames: [
      { name: game.title, integration: "override", files: [source] },
    ],
  })
);
globalThis.__fullSaveTest = {
  root,
  profile,
  appData: path.join(base, "appData"),
  running: false,
  game,
  db: {
    get: async (key) => store.get(key),
    put: async (key, value) => store.set(key, value),
  },
  games: { get: async () => game, values: () => ({ all: async () => [game] }) },
};
const modules = {
  electron:
    'export const app={isPackaged:false,getAppPath:()=>globalThis.__fullSaveTest.root};export const Notification={isSupported:()=>false};export const shell={openPath:async()=>""};',
  i18next: "export const t=key=>key;",
  "../level/level": "export const db=globalThis.__fullSaveTest.db;",
  "../level/sublevels/games":
    "export const gamesSublevel=globalThis.__fullSaveTest.games;",
  "../level/sublevels/keys":
    "export const levelKeys={game:(shop,id)=>`${shop}:${id}`};",
  "./system-path":
    'export const SystemPath={getPath:key=>key==="appData"?globalThis.__fullSaveTest.appData:globalThis.__fullSaveTest.profile};',
  "./native-addon":
    'export const NativeAddon={getSystemProcessMap:async()=>({processTree:[{pid:424242,parentPid:1,exe:globalThis.__fullSaveTest.running?globalThis.__fullSaveTest.game.executablePath:"C:/unrelated/system.exe"}]})};',
  "./logger": "export const logger={error(){},warn(){}};",
  "./game-running-state":
    "export const getTrackedGamesRunning=()=>globalThis.__fullSaveTest.running?[{}]:[];",
};
const bundle = path.join(base, "service-under-test.mjs");
await build({
  stdin: {
    contents:
      'export * from "./src/main/services/ludusavi-local.ts"; export * from "./src/main/services/ludusavi-local-manager.ts";',
    resolveDir: root,
  },
  outfile: bundle,
  bundle: true,
  platform: "node",
  format: "esm",
  packages: "external",
  plugins: [
    {
      name: "isolated-service",
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
const service = await import(pathToFileURL(bundle).href);
const progress = path.join(source, "progress.sav");
await fs.writeFile(progress, "version one");
const backup = await service.enqueueLudusaviLocalBackup(key, false);
assert.equal(backup.status, "success", backup.message);
const first = (await service.listSaveBackupVersions(key)).versions;
assert.equal(first.length, 1);
await new Promise((resolve) => setTimeout(resolve, 1100));
await fs.writeFile(progress, "version two with new progress");
const second = await service.enqueueLudusaviLocalBackup(key, false);
assert.equal(second.status, "success", second.message);
const all = (await service.listSaveBackupVersions(key)).versions;
assert.equal(all.length, 2);
assert.match(
  (await service.validateSaveBackup(key, all.at(-1).name)).message,
  /Validation passed/
);
const preview = await service.previewSaveRestore(key, first[0].name);
assert.equal(preview.files.length, 1);
assert.equal(
  await fs.readFile(progress, "utf8"),
  "version two with new progress"
);
globalThis.__fullSaveTest.running = true;
await assert.rejects(
  service.confirmSaveOperation(preview.token),
  /game_running/
);
globalThis.__fullSaveTest.running = false;
await service.saveLudusaviLocalSettings({ ...settings, fullRetention: 9 });
await assert.rejects(
  service.confirmSaveOperation(preview.token),
  /settings changed/
);
assert.equal(
  await fs.readFile(progress, "utf8"),
  "version two with new progress"
);
await service.saveLudusaviLocalSettings(settings);
const confirmed = await service.previewSaveRestore(key, first[0].name);
const restored = await service.confirmSaveOperation(confirmed.token);
assert.equal(await fs.readFile(progress, "utf8"), "version one");
assert.ok(restored.safetyPath);
const safetyGames = await fs.readdir(restored.safetyPath);
const snapshot = path.join(restored.safetyPath, safetyGames[0]);
const snapshotFiles = await fs.readdir(snapshot);
const zip = path.join(
  snapshot,
  snapshotFiles.find((name) => name.endsWith(".zip"))
);
const mapping = YAML.parse(
  await fs.readFile(path.join(snapshot, "mapping.yaml"), "utf8")
);
assert.equal(Object.keys(mapping.backups[0].files).length, 1);
const sourceName = Object.keys(mapping.backups[0].files)[0];
const [driveName, drivePrefix] = Object.entries(mapping.drives).find(
  ([, prefix]) => sourceName.startsWith(prefix + "/")
);
const member = driveName + "/" + sourceName.slice(drivePrefix.length + 1);
const extracted = await execute(
  path.resolve("binaries/7z.exe"),
  ["e", "-so", zip, member],
  { encoding: "utf8", windowsHide: true }
);
assert.equal(extracted.stdout, "version two with new progress");
await assert.rejects(service.confirmSaveOperation(confirmed.token), /again/);

// Exercise the uncompressed format and reject a corrupted archived version.
await service.saveLudusaviLocalSettings({
  ...settings,
  format: "simple",
  differentialRetention: 0,
});
await new Promise((resolve) => setTimeout(resolve, 1100));
const simple = await service.enqueueLudusaviLocalBackup(key, false);
assert.equal(simple.status, "success", simple.message);
const simpleVersion = (await service.listSaveBackupVersions(key)).versions.find(
  (item) => !item.name.endsWith(".zip")
);
assert.ok(simpleVersion);
assert.match(
  (await service.validateSaveBackup(key, simpleVersion.name)).message,
  /0 ZIP archives/
);
await service.saveLudusaviLocalSettings(settings);
const originalZip = path.join(destination, game.title, first[0].name);
const originalBytes = await fs.readFile(originalZip);
try {
  await fs.writeFile(originalZip, Buffer.from("invalid archive"));
  await assert.rejects(service.validateSaveBackup(key, first[0].name));
  assert.equal(await fs.readFile(progress, "utf8"), "version one");
} finally {
  await fs.writeFile(originalZip, originalBytes);
}

// Recovery on a fresh machine must work when the live save file is absent.
await fs.rm(progress);
const missingLivePreview = await service.previewSaveRestore(key, first[0].name);
const missingLiveRestore = await service.confirmSaveOperation(
  missingLivePreview.token
);
assert.equal(await fs.readFile(progress, "utf8"), "version one");
assert.equal(missingLiveRestore.safetyPath, undefined);

const advanced = YAML.parse(await service.getSaveAdvancedConfig());
advanced.backup.filter = { ignoredPaths: [path.join(source, "exclude.tmp")] };
advanced.cloud.synchronize = true;
await service.saveSaveAdvancedConfig(YAML.stringify(advanced));
const readBack = YAML.parse(await service.getSaveAdvancedConfig());
assert.equal(readBack.cloud.synchronize, false);
assert.deepEqual(readBack.backup.filter, advanced.backup.filter);
const beforeInvalid = await service.getSaveAdvancedConfig();
await assert.rejects(
  service.saveSaveAdvancedConfig("roots: definitely-invalid"),
  /could not complete/
);
assert.equal(await service.getSaveAdvancedConfig(), beforeInvalid);
await assert.rejects(service.previewSaveCloudTransfer(key, "upload"), /Rclone/);
await service.importStandaloneSaveConfig();
await service.clearLudusaviLocalLogs();
assert.deepEqual(store.get("ludusaviLocalHistory"), []);
assert.equal(await fs.readFile(progress, "utf8"), "version one");
assert.ok((await fs.readdir(destination)).some((name) => name === game.title));
console.log(
  "PASS: real ZIP + differential backups, version list, contents preview, archive validation, stopped-game guard, changed-settings guard, explicit restore, verified pre-restore snapshot, single-use confirmation, advanced validation/import, and scoped log cleanup."
);
console.log("Fixture root: " + base);

const rcloneIndex = process.argv.indexOf("--rclone");
const rcloneArgument =
  rcloneIndex < 0 ? undefined : process.argv[rcloneIndex + 1];
if (rcloneIndex >= 0 && !rcloneArgument)
  throw Error("Pass the Rclone executable path after --rclone.");
if (rcloneArgument) {
  const remote = path.join(base, "remote");
  await fs.mkdir(remote);
  const remoteConfig = path.join(base, "rclone.conf");
  await fs.writeFile(remoteConfig, "[fixture]\ntype = local\n");
  const remoteAdvanced = YAML.parse(await service.getSaveAdvancedConfig());
  remoteAdvanced.apps = {
    rclone: {
      path: path.resolve(rcloneArgument),
      arguments: `--config "${remoteConfig.replaceAll("\\", "/")}"`,
    },
  };
  remoteAdvanced.cloud = {
    remote: { Custom: { id: "fixture" } },
    path: remote.replaceAll("\\", "/"),
    synchronize: false,
  };
  await service.saveSaveAdvancedConfig(YAML.stringify(remoteAdvanced));
  const upload = await service.previewSaveCloudTransfer(key, "upload");
  assert.ok(upload.files.length > 0);
  assert.deepEqual(await fs.readdir(remote), []);
  const result = await service.confirmSaveOperation(upload.token);
  assert.match(result.message, /upload.*completed/);
  assert.ok((await fs.readdir(remote)).includes(game.title));
  assert.equal(await fs.readFile(progress, "utf8"), "version one");
  await assert.rejects(service.confirmSaveOperation(upload.token), /again/);
  const download = await service.previewSaveCloudTransfer(key, "download");
  await service.confirmSaveOperation(download.token);
  assert.equal(await fs.readFile(progress, "utf8"), "version one");
  const state = await service.getLudusaviLocalState();
  assert.ok(
    state.history.some(
      (item) => item.operation === "upload" && item.status === "success"
    )
  );
  assert.ok(
    state.history.some(
      (item) => item.operation === "download" && item.status === "success"
    )
  );
  console.log(
    "PASS: real Rclone local-remote upload/download previews are non-writing; explicit confirmations transfer archives; live saves stay unchanged; confirmations cannot be reused."
  );
}
