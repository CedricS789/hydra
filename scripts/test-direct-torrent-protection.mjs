// Synthetic backend only: this test never loads libtorrent or contacts peers.
/* global globalThis */
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { build } from "esbuild";

const root = process.cwd();
await fs.mkdir(path.join(root, ".tmp"), { recursive: true });
const base = await fs.mkdtemp(path.join(root, ".tmp", "torrent-protection-"));
const unitBundle = path.join(base, "unit-tests.mjs");
await build({
  stdin: {
    contents:
      'import "./src/main/services/torrent-client.test.ts"; import "./src/shared/direct-torrent-policy.test.ts";',
    resolveDir: root,
  },
  bundle: true,
  platform: "node",
  format: "esm",
  outfile: unitBundle,
});
const result = await promisify(execFile)(
  process.execPath,
  ["--test", unitBundle],
  { windowsHide: true }
);
process.stdout.write(result.stdout);

const downloads = new Map();
const fixture = {
  nativeCalls: [],
  trackerCalls: 0,
  writes: 0,
  active: null,
  pauses: 0,
  handlers: new Map(),
  downloads: {
    get: async (key) => downloads.get(key),
    put: async (key, value) => {
      fixture.writes++;
      downloads.set(key, value);
    },
    del: async (key) => downloads.delete(key),
    values: () => ({ all: async () => [...downloads.values()] }),
  },
  manager: {
    getActiveDownloadId: () => fixture.active,
    pauseDownload: async () => {
      fixture.pauses++;
      fixture.active = null;
    },
  },
};
globalThis.__torrentProtectionTest = fixture;
const source = (file) =>
  JSON.stringify(path.join(root, file).replaceAll("\\", "/"));
const modules = {
  "@main/services/torrent-service": `export * from ${source("src/main/services/torrent-service.ts")};`,
  "./native-addon": `const f=globalThis.__torrentProtectionTest;export const NativeAddon={torrentInitialize:async()=>{f.nativeCalls.push('initialize')},torrentRequest:async()=>{f.nativeCalls.push('request');return '{"result":null}'},torrentShutdown:async()=>{f.nativeCalls.push('shutdown')}};`,
  "../register-event":
    "export const registerEvent=(name,handler)=>globalThis.__torrentProtectionTest.handlers.set(name,handler);",
  "@main/level":
    "export const downloadsSublevel=globalThis.__torrentProtectionTest.downloads;export const gamesSublevel={get:async()=>null};export const levelKeys={game:(shop,id)=>`${shop}:${id}`};",
  "@shared": `export {Downloader,DownloadError} from ${source("src/shared/constants.ts")};export const parseBytes=()=>0;`,
  "@main/services": `export {DownloadOrchestrator} from ${source("src/main/services/download-orchestrator.ts")};export const DownloadManager=globalThis.__torrentProtectionTest.manager;export const WindowManager={sendDownloadsUpdated(){}};export const HydraApi={post:async()=>{}};export const logger={log(){},error(){},warn(){}};`,
  "@main/services/library-sync": "export const createGame=async()=>{};",
  "@main/helpers":
    "export const getGlobalTrackers=async()=>{globalThis.__torrentProtectionTest.trackerCalls++;return []};export const getMultipartDownloadParts=async()=>[];export const handleDownloadError=error=>({ok:false,error:error.message});export const isKnownDownloadError=()=>true;export const prepareGameEntry=async()=>{};",
  "./download/download-manager":
    "export const DownloadManager=globalThis.__torrentProtectionTest.manager;",
  "./download/debrid-files": "export const isDebridPendingError=()=>false;",
  "./window-manager": "export const WindowManager={sendDownloadsUpdated(){}};",
  "./logger": "export const logger={log(){},warn(){},error(){}};",
  "./download-layout-state":
    "export const syncDownloadLayoutState=async()=>{};export const getNormalizedDownloadLayoutState=async()=>({queueOrder:[],pausedOrder:[]});export const getNextQueuedDownloadFromLayout=()=>null;export const getPausedDownloadsOrderedByLayout=()=>[];export const getQueuedDownloadsOrderedByLayout=()=>[];export const removeDownloadFromLayoutState=async()=>{};export const saveDownloadLayoutState=async()=>{};export const setDownloadLayoutQueues=async()=>{};",
};
const bundle = path.join(base, "backend.mjs");
await build({
  stdin: {
    contents: `export * from "./src/main/services/torrent-service.ts";
      export {DownloadOrchestrator} from "./src/main/services/download-orchestrator.ts";
      import "./src/main/events/torrenting/get-torrent-files.ts";
      import "./src/main/events/torrenting/start-game-download.ts";
      import "./src/main/events/torrenting/add-game-to-queue.ts";
      import "./src/main/events/torrenting/resume-game-seed.ts";`,
    resolveDir: root,
  },
  bundle: true,
  platform: "node",
  format: "esm",
  outfile: bundle,
  plugins: [
    {
      name: "synthetic-torrent-backend",
      setup(plugin) {
        plugin.onResolve({ filter: /.*/ }, (args) =>
          Object.hasOwn(modules, args.path)
            ? { path: args.path, namespace: "fixture" }
            : undefined
        );
        plugin.onLoad({ filter: /.*/, namespace: "fixture" }, (args) => ({
          contents: modules[args.path],
          loader: "js",
          resolveDir: root,
        }));
      },
    },
  ],
});
const backend = await import(pathToFileURL(bundle).href);
assert.equal(backend.isDirectTorrentAllowed(), false);
await backend.setDirectTorrentAccess(false);
const disabled = "download_error_direct_torrent_disabled";
const magnet = "magnet:?xt=urn:btih:0123456789012345678901234567890123456789";
const payload = {
  shop: "steam",
  objectId: "test",
  title: "Synthetic",
  uri: magnet,
  downloader: 1,
  downloadPath: base,
};
for (const name of ["startGameDownload", "addGameToQueue"])
  assert.deepEqual(await fixture.handlers.get(name)(null, payload), {
    ok: false,
    error: disabled,
  });
assert.deepEqual(await fixture.handlers.get("getTorrentFiles")(null, magnet), {
  ok: false,
  error: disabled,
});
await assert.rejects(
  fixture.handlers.get("resumeGameSeed")(null, "steam", "test"),
  { code: disabled }
);
assert.equal(fixture.writes, 0, "Blocked IPC must not persist a download");
assert.equal(fixture.trackerCalls, 0, "Blocked IPC must not fetch trackers");
assert.deepEqual(
  fixture.nativeCalls,
  [],
  "Default-off must not load the native torrent backend"
);

downloads.set("steam:active", {
  shop: "steam",
  objectId: "active",
  downloader: 1,
  status: "active",
  queued: true,
  shouldSeed: true,
  progress: 0.4,
});
downloads.set("steam:seed", {
  shop: "steam",
  objectId: "seed",
  downloader: 1,
  status: "seeding",
  shouldSeed: true,
  progress: 1,
});
downloads.set("steam:debrid", {
  shop: "steam",
  objectId: "debrid",
  downloader: 0,
  status: "paused",
  queued: true,
});
const debrid = structuredClone(downloads.get("steam:debrid"));
fixture.active = "steam:active";
await backend.DownloadOrchestrator.suspendDirectTorrentDownloads();
assert.equal(fixture.pauses, 1);
assert.equal(downloads.get("steam:active").status, "paused");
assert.equal(downloads.get("steam:active").queued, false);
assert.equal(downloads.get("steam:active").shouldSeed, false);
assert.equal(downloads.get("steam:seed").status, "complete");
assert.equal(downloads.get("steam:seed").shouldSeed, false);
assert.deepEqual(downloads.get("steam:debrid"), debrid);
assert.deepEqual(fixture.nativeCalls, []);

await assert.rejects(
  backend.DownloadOrchestrator.resumeDownload("steam", "active"),
  { code: disabled }
);
for (const area of ["hero", "queue"])
  await assert.rejects(
    backend.DownloadOrchestrator.moveDownloadPlacement("steam", "active", area),
    { code: disabled }
  );
assert.equal(downloads.get("steam:active").queued, false);

await backend.setDirectTorrentAccess(true);
await backend.TorrentService.call("torrent_files", { magnet });
await backend.setDirectTorrentAccess(false);
await assert.rejects(
  backend.TorrentService.call("action", { action: "resume_seeding" }),
  { code: disabled }
);
assert.deepEqual(fixture.nativeCalls, ["initialize", "request", "shutdown"]);
console.log(
  "PASS: blocked download/queue/metadata/seed IPC, no default native initialization or trackers, torrent jobs suspended without changing debrid jobs, explicit re-enable and shutdown."
);
