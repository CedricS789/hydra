import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import type { Download, Game, GameShop } from "@types";
import { Downloader } from "../../../shared/constants.js";
import {
  createGameUninstallCore,
  type GameUninstallDependencies,
} from "./game-uninstall-core.js";

const makeGame = (overrides: Partial<Game> = {}): Game =>
  ({
    title: "Cool Game",
    iconUrl: null,
    libraryHeroImageUrl: null,
    logoImageUrl: null,
    playTimeInMilliseconds: 0,
    lastTimePlayed: null,
    objectId: "42",
    shop: "steam",
    remoteId: null,
    isDeleted: false,
    ...overrides,
  }) as Game;

const makeDownload = (overrides: Partial<Download> = {}): Download =>
  ({
    shop: "steam",
    objectId: "42",
    uri: "magnet:?xt=urn:btih:123",
    folderName: "CoolGameRepack",
    downloadPath: "",
    progress: 1,
    downloader: Downloader.Torrent,
    bytesDownloaded: 1000,
    fileSize: 1000,
    shouldSeed: false,
    status: "complete",
    queued: false,
    timestamp: 1,
    extracting: false,
    automaticallyExtract: false,
    automaticallyDeleteArchiveFiles: false,
    ...overrides,
  }) as Download;

const createDeps = (
  tempRoot: string,
  overrides: Partial<GameUninstallDependencies> = {}
) => {
  const calls: string[] = [];
  let currentGame: Game | undefined;
  let currentDownload: Download | undefined;

  const deps: GameUninstallDependencies = {
    platform: process.platform,
    getGame: async () => currentGame,
    getAllGames: async () => (currentGame ? [currentGame] : []),
    getDownload: async () => currentDownload,
    getDownloadsPath: async () => path.join(tempRoot, "Downloads"),
    getSafetyContext: async () => ({
      platform: process.platform,
      protectedRoots: [tempRoot, path.join(tempRoot, "Downloads")],
    }),
    findGameRootFromExe: async (exePath) => path.dirname(exePath),
    getDirectorySize: async () => 2048,
    hasSourceArchive: async () => false,
    detectNativeUninstaller: async () => null,
    isGameRunning: () => false,
    isGameDownloading: () => false,
    isGameTransferring: () => false,
    isInstallerRunning: () => false,
    getEffectiveWinePrefix: () => null,
    legacyDefaultWinePrefixPath: null,
    homeDir: path.join(tempRoot, "home"),
    validateWinePrefix: () => true,
    deleteDirectory: async (dirPath) => {
      calls.push(`deleteDirectory:${dirPath}`);
      await fs.promises.rm(dirPath, { recursive: true, force: true });
    },
    deleteDownloadFolder: async (shop: GameShop, objectId: string, opts) => {
      calls.push(
        `deleteDownloadFolder:${shop}:${objectId}:${Boolean(opts.deleteSourceArchive)}`
      );
      currentDownload = undefined;
    },
    clearGameInstallationFields: async (_shop, _objectId, opts) => {
      calls.push(`clearFields:${Boolean(opts.clearWinePrefix)}`);
      if (currentGame) {
        currentGame = {
          ...currentGame,
          executablePath: null,
          installedSizeInBytes: null,
          automaticCloudSync: false,
        };
      }
    },
    removeFromLibrary: async (shop, objectId) => {
      calls.push(`removeFromLibrary:${shop}:${objectId}`);
    },
    launchNativeUninstaller: async () => {
      calls.push("launchNativeUninstaller");
      return "launched";
    },
    notifyLibraryUpdated: () => {
      calls.push("notifyLibraryUpdated");
    },
    ...overrides,
  };

  return {
    deps,
    calls,
    setGame: (g: Game | undefined) => {
      currentGame = g;
    },
    setDownload: (d: Download | undefined) => {
      currentDownload = d;
    },
    getGameState: () => currentGame,
  };
};

describe("game-uninstall-core", () => {
  it("inspects a repack installed separately from its download folder", async (t) => {
    const tempRoot = await fs.promises.mkdtemp(
      path.join(os.tmpdir(), "hydra-core-inspect-")
    );
    t.after(() => fs.promises.rm(tempRoot, { recursive: true, force: true }));

    const installDir = path.join(tempRoot, "Installed", "CoolGame");
    const exePath = path.join(installDir, "game.exe");
    const downloadDir = path.join(tempRoot, "Downloads", "CoolGameRepack");
    await fs.promises.mkdir(installDir, { recursive: true });
    await fs.promises.mkdir(downloadDir, { recursive: true });
    await fs.promises.writeFile(exePath, "exe");

    const env = createDeps(tempRoot, {
      detectNativeUninstaller: async (root) => ({
        kind: "in-folder",
        label: "unins000.exe",
        executablePath: path.join(root, "unins000.exe"),
        args: [],
      }),
    });
    env.setGame(makeGame({ executablePath: exePath, installedSizeInBytes: 5000 }));
    env.setDownload(
      makeDownload({
        downloadPath: path.join(tempRoot, "Downloads"),
        folderName: "CoolGameRepack",
      })
    );

    const core = createGameUninstallCore(env.deps);
    const plan = await core.inspectGameUninstall("steam", "42");

    assert.equal(plan.canDeleteGameRoot, true);
    assert.equal(plan.gameRoot, await fs.promises.realpath(installDir));
    assert.equal(plan.gameRootSizeInBytes, 5000);
    assert.equal(plan.nativeUninstaller?.label, "unins000.exe");
    assert.equal(plan.hasDownloadFolder, true);
    assert.equal(plan.downloadFolderPath, downloadDir);
    assert.equal(plan.downloadFolderSizeInBytes, 2048);
  });

  it("blocks execution when the game is running or unsafe", async (t) => {
    const tempRoot = await fs.promises.mkdtemp(
      path.join(os.tmpdir(), "hydra-core-block-")
    );
    t.after(() => fs.promises.rm(tempRoot, { recursive: true, force: true }));

    const installDir = path.join(tempRoot, "Installed", "CoolGame");
    const exePath = path.join(installDir, "game.exe");
    await fs.promises.mkdir(installDir, { recursive: true });
    await fs.promises.writeFile(exePath, "exe");

    const env = createDeps(tempRoot, { isGameRunning: () => true });
    env.setGame(makeGame({ executablePath: exePath }));

    const core = createGameUninstallCore(env.deps);
    const blocked = await core.executeGameUninstall("steam", "42", {
      mode: "folder-delete",
    });

    assert.deepEqual(blocked, {
      status: "blocked",
      blockReason: "game-running",
      message: undefined,
    });
    assert.equal(fs.existsSync(installDir), true);
  });

  it("deletes game folder, cleans metadata, and optionally deletes download folder and library entry", async (t) => {
    const tempRoot = await fs.promises.mkdtemp(
      path.join(os.tmpdir(), "hydra-core-delete-")
    );
    t.after(() => fs.promises.rm(tempRoot, { recursive: true, force: true }));

    const installDir = path.join(tempRoot, "Installed", "CoolGame");
    const exePath = path.join(installDir, "game.exe");
    await fs.promises.mkdir(installDir, { recursive: true });
    await fs.promises.writeFile(exePath, "exe");

    const env = createDeps(tempRoot);
    env.setGame(makeGame({ executablePath: exePath }));
    env.setDownload(
      makeDownload({
        downloadPath: path.join(tempRoot, "Downloads"),
        folderName: "CoolGameRepack",
      })
    );

    const core = createGameUninstallCore(env.deps);
    const result = await core.executeGameUninstall("steam", "42", {
      mode: "folder-delete",
      deleteDownloadFolder: true,
      deleteSourceArchive: true,
      removeFromLibrary: true,
    });

    assert.deepEqual(result, { status: "uninstalled" });
    assert.equal(fs.existsSync(installDir), false);
    assert.equal(env.getGameState()?.executablePath, null);
    assert.deepEqual(env.calls.slice(1), [
      "deleteDownloadFolder:steam:42:true",
      "clearFields:false",
      "removeFromLibrary:steam:42",
      "notifyLibraryUpdated",
    ]);
  });

  it("defers optional cleanup until native uninstaller completion callback fires", async (t) => {
    const tempRoot = await fs.promises.mkdtemp(
      path.join(os.tmpdir(), "hydra-core-native-")
    );
    t.after(() => fs.promises.rm(tempRoot, { recursive: true, force: true }));

    const installDir = path.join(tempRoot, "Installed", "CoolGame");
    const exePath = path.join(installDir, "game.exe");
    await fs.promises.mkdir(installDir, { recursive: true });
    await fs.promises.writeFile(exePath, "exe");

    let completeCallback: (() => Promise<void>) | null = null;
    const env = createDeps(tempRoot, {
      detectNativeUninstaller: async (root) => ({
        kind: "in-folder",
        label: "unins000.exe",
        executablePath: path.join(root, "unins000.exe"),
        args: [],
      }),
      launchNativeUninstaller: async ({ onUninstallCompleted }) => {
        completeCallback = onUninstallCompleted;
        return "launched";
      },
    });
    env.setGame(makeGame({ executablePath: exePath }));

    const core = createGameUninstallCore(env.deps);
    const result = await core.executeGameUninstall("steam", "42", {
      mode: "native-uninstaller",
      deleteDownloadFolder: true,
      removeFromLibrary: true,
    });

    assert.deepEqual(result, { status: "uninstaller-launched" });
    assert.equal(env.calls.length, 0);

    await completeCallback!();
    assert.deepEqual(env.calls, [
      "deleteDownloadFolder:steam:42:false",
      "clearFields:false",
      "removeFromLibrary:steam:42",
      "notifyLibraryUpdated",
    ]);
  });
});
