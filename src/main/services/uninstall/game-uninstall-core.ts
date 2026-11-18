import fs from "node:fs";
import path from "node:path";
import type {
  Download,
  ExecuteGameUninstallOptions,
  ExecuteGameUninstallResult,
  Game,
  GameShop,
  GameUninstallPlan,
  GameUninstallSafetyBlock,
  NativeUninstallerInfo,
} from "@types";
import { Downloader } from "../../../shared/constants.js";
import {
  isPathWithin,
  normalizeComparablePath,
  resolveIsolatedWinePrefixForUninstall,
  type UninstallSafetyContext,
  validateUninstallDirectory,
} from "./game-uninstall-safety.js";

export interface GameUninstallDependencies {
  platform: NodeJS.Platform;
  getGame: (shop: GameShop, objectId: string) => Promise<Game | undefined>;
  getAllGames: () => Promise<Game[]>;
  getDownload: (
    shop: GameShop,
    objectId: string
  ) => Promise<Download | undefined>;
  getDownloadsPath: () => Promise<string>;
  getSafetyContext: () => Promise<UninstallSafetyContext>;
  findGameRootFromExe: (exePath: string) => Promise<string | null>;
  getDirectorySize: (dirPath: string) => Promise<number>;
  hasSourceArchive: (download: Download) => Promise<boolean>;
  detectNativeUninstaller: (
    gameRoot: string,
    executablePath: string | null
  ) => Promise<NativeUninstallerInfo | null>;
  isGameRunning: (shop: GameShop, objectId: string) => boolean;
  isGameDownloading: (download: Download | undefined) => boolean;
  isGameTransferring: (shop: GameShop, objectId: string) => boolean;
  isInstallerRunning: (
    shop: GameShop,
    objectId: string,
    download: Download | undefined
  ) => boolean;
  getEffectiveWinePrefix: (game: Game) => string | null;
  legacyDefaultWinePrefixPath: string | null;
  homeDir: string;
  envWinePrefix?: string | null;
  validateWinePrefix: (prefixPath: string) => boolean;
  deleteDirectory: (dirPath: string) => Promise<void>;
  deleteDownloadFolder: (
    shop: GameShop,
    objectId: string,
    options: { deleteSourceArchive?: boolean }
  ) => Promise<void>;
  clearGameInstallationFields: (
    shop: GameShop,
    objectId: string,
    options: { clearWinePrefix?: boolean }
  ) => Promise<void>;
  removeFromLibrary: (shop: GameShop, objectId: string) => Promise<void>;
  launchNativeUninstaller: (params: {
    shop: GameShop;
    objectId: string;
    uninstaller: NativeUninstallerInfo;
    gameRoot: string;
    executablePath: string;
    game: Game;
    onUninstallCompleted: () => Promise<void>;
  }) => Promise<"launched" | "cancelled">;
  notifyLibraryUpdated: () => void;
  pathExists?: (targetPath: string) => Promise<boolean>;
  logError?: (message: string, error?: unknown) => void;
}

const defaultPathExists = async (targetPath: string): Promise<boolean> => {
  try {
    await fs.promises.lstat(targetPath);
    return true;
  } catch {
    return false;
  }
};

export const createGameUninstallCore = (deps: GameUninstallDependencies) => {
  const activeUninstalls = new Set<string>();
  const pathExists = deps.pathExists ?? defaultPathExists;

  const gameKeyOf = (shop: GameShop, objectId: string) => `${shop}:${objectId}`;

  const getActivityBlock = (
    shop: GameShop,
    objectId: string,
    download: Download | undefined
  ): GameUninstallSafetyBlock | null => {
    if (deps.isGameRunning(shop, objectId)) {
      return { reason: "game-running" };
    }
    if (deps.isGameDownloading(download)) {
      return { reason: "downloading" };
    }
    if (deps.isGameTransferring(shop, objectId)) {
      return { reason: "transferring" };
    }
    if (deps.isInstallerRunning(shop, objectId, download)) {
      return { reason: "installer-running" };
    }
    return null;
  };

  const resolveDownloadFolder = async (
    download: Download | undefined
  ): Promise<{ path: string | null; exists: boolean }> => {
    if (!download || download.downloader === Downloader.Epic) {
      return { path: null, exists: false };
    }
    if (!download.folderName) return { path: null, exists: false };

    const base = download.downloadPath || (await deps.getDownloadsPath());
    if (!base) return { path: null, exists: false };

    const candidate = path.join(base, download.folderName);
    const exists = await pathExists(candidate);
    return { path: exists ? candidate : null, exists };
  };

  const inspectGameUninstall = async (
    shop: GameShop,
    objectId: string
  ): Promise<GameUninstallPlan> => {
    const [game, download, allGames, safetyContext] = await Promise.all([
      deps.getGame(shop, objectId),
      deps.getDownload(shop, objectId),
      deps.getAllGames(),
      deps.getSafetyContext(),
    ]);

    const activityBlock = getActivityBlock(shop, objectId, download);
    const title = game?.title ?? objectId;
    const executablePath = game?.executablePath ?? null;

    let gameRoot: string | null = null;
    let gameRootSizeInBytes: number | null = null;
    let canDeleteGameRoot = false;
    let gameRootBlock: GameUninstallSafetyBlock | null = null;
    let nativeUninstaller: NativeUninstallerInfo | null = null;

    if (executablePath && game) {
      const exeExists = await pathExists(executablePath);
      if (!exeExists) {
        gameRootBlock = { reason: "missing-files", details: executablePath };
      } else {
        const candidateRoot = await deps
          .findGameRootFromExe(executablePath)
          .catch(() => null);

        if (!candidateRoot) {
          gameRoot = path.dirname(executablePath);
          gameRootBlock = {
            reason: "unsafe-path",
            details: path.dirname(executablePath),
          };
        } else {
          const validation = await validateUninstallDirectory(
            candidateRoot,
            game,
            allGames,
            safetyContext
          );
          gameRoot = validation.resolvedPath ?? candidateRoot;
          canDeleteGameRoot = validation.valid;
          gameRootBlock = validation.block;
        }

        if (gameRoot && gameRootBlock?.reason !== "missing-files") {
          nativeUninstaller = await deps
            .detectNativeUninstaller(gameRoot, executablePath)
            .catch(() => null);

          if (canDeleteGameRoot) {
            gameRootSizeInBytes =
              game.installedSizeInBytes ??
              (await deps.getDirectorySize(gameRoot).catch(() => null));
          }
        }
      }
    }

    const downloadFolder = await resolveDownloadFolder(download);
    const downloadCoveredByGameRoot = Boolean(
      downloadFolder.path &&
        gameRoot &&
        isPathWithin(downloadFolder.path, gameRoot, deps.platform)
    );

    const hasSeparateDownloadFolder = Boolean(
      downloadFolder.exists && downloadFolder.path && !downloadCoveredByGameRoot
    );

    const downloadFolderSizeInBytes =
      hasSeparateDownloadFolder && downloadFolder.path
        ? await deps.getDirectorySize(downloadFolder.path).catch(() => null)
        : null;

    const hasSourceArchive = download
      ? await deps.hasSourceArchive(download).catch(() => false)
      : false;

    const isolatedWinePrefixPath = game
      ? await resolveIsolatedWinePrefixForUninstall({
          targetGame: game,
          effectivePrefixPath: deps.getEffectiveWinePrefix(game),
          legacyDefaultPrefixPath: deps.legacyDefaultWinePrefixPath,
          homeDir: deps.homeDir,
          envWinePrefix: deps.envWinePrefix,
          allGames,
          resolveEffectivePrefixForGame: deps.getEffectiveWinePrefix,
          validatePrefix: deps.validateWinePrefix,
          context: safetyContext,
        })
      : null;

    return {
      shop,
      objectId,
      title,
      executablePath,
      gameRoot,
      gameRootSizeInBytes,
      canDeleteGameRoot,
      gameRootBlock,
      nativeUninstaller,
      downloadFolderPath: hasSeparateDownloadFolder
        ? downloadFolder.path
        : null,
      downloadFolderSizeInBytes,
      hasDownloadFolder: hasSeparateDownloadFolder,
      hasSourceArchive,
      isolatedWinePrefixPath,
      activityBlock,
    };
  };

  const runPostUninstallCleanup = async (
    shop: GameShop,
    objectId: string,
    options: {
      deleteDownloadFolder: boolean;
      deleteSourceArchive: boolean;
      deleteWinePrefix: boolean;
      removeFromLibrary: boolean;
    }
  ) => {
    let deletedWinePrefix = false;

    if (options.deleteWinePrefix) {
      const [game, allGames, safetyContext] = await Promise.all([
        deps.getGame(shop, objectId),
        deps.getAllGames(),
        deps.getSafetyContext(),
      ]);
      if (game) {
        const isolatedPrefix = await resolveIsolatedWinePrefixForUninstall({
          targetGame: game,
          effectivePrefixPath: deps.getEffectiveWinePrefix(game),
          legacyDefaultPrefixPath: deps.legacyDefaultWinePrefixPath,
          homeDir: deps.homeDir,
          envWinePrefix: deps.envWinePrefix,
          allGames,
          resolveEffectivePrefixForGame: deps.getEffectiveWinePrefix,
          validatePrefix: deps.validateWinePrefix,
          context: safetyContext,
        });
        if (isolatedPrefix) {
          await deps.deleteDirectory(isolatedPrefix);
          deletedWinePrefix = true;
        }
      }
    }

    if (options.deleteDownloadFolder) {
      await deps.deleteDownloadFolder(shop, objectId, {
        deleteSourceArchive: options.deleteSourceArchive,
      });
    }

    await deps.clearGameInstallationFields(shop, objectId, {
      clearWinePrefix: deletedWinePrefix,
    });

    if (options.removeFromLibrary) {
      await deps.removeFromLibrary(shop, objectId);
    }

    deps.notifyLibraryUpdated();
  };

  const executeGameUninstall = async (
    shop: GameShop,
    objectId: string,
    options: ExecuteGameUninstallOptions
  ): Promise<ExecuteGameUninstallResult> => {
    const key = gameKeyOf(shop, objectId);
    if (activeUninstalls.has(key)) {
      return { status: "blocked", blockReason: "installer-running" };
    }

    activeUninstalls.add(key);

    try {
      const [game, download, allGames, safetyContext] = await Promise.all([
        deps.getGame(shop, objectId),
        deps.getDownload(shop, objectId),
        deps.getAllGames(),
        deps.getSafetyContext(),
      ]);

      const activityBlock = getActivityBlock(shop, objectId, download);
      if (activityBlock) {
        return {
          status: "blocked",
          blockReason: activityBlock.reason,
          message: activityBlock.details,
        };
      }

      if (!game) {
        return { status: "blocked", blockReason: "missing-files" };
      }

      const plan = await inspectGameUninstall(shop, objectId);
      const cleanupFlags = {
        deleteDownloadFolder: Boolean(options.deleteDownloadFolder),
        deleteSourceArchive: Boolean(options.deleteSourceArchive),
        deleteWinePrefix: Boolean(options.deleteWinePrefix),
        removeFromLibrary: Boolean(options.removeFromLibrary),
      };

      if (options.mode === "native-uninstaller") {
        if (
          !plan.nativeUninstaller ||
          !plan.gameRoot ||
          !game.executablePath
        ) {
          return {
            status: "blocked",
            blockReason: plan.gameRootBlock?.reason ?? "missing-files",
            message: plan.gameRootBlock?.details,
          };
        }

        const downloadFolder = await resolveDownloadFolder(download);
        const downloadCoveredByGameRoot = Boolean(
          downloadFolder.path &&
            isPathWithin(downloadFolder.path, plan.gameRoot, deps.platform)
        );

        const launchStatus = await deps.launchNativeUninstaller({
          shop,
          objectId,
          uninstaller: plan.nativeUninstaller,
          gameRoot: plan.gameRoot,
          executablePath: game.executablePath,
          game,
          onUninstallCompleted: async () => {
            await runPostUninstallCleanup(shop, objectId, {
              ...cleanupFlags,
              deleteDownloadFolder:
                cleanupFlags.deleteDownloadFolder || downloadCoveredByGameRoot,
            });
          },
        });

        if (launchStatus === "cancelled") {
          return { status: "cancelled-by-user" };
        }

        return { status: "uninstaller-launched" };
      }

      // mode === "folder-delete"
      if (game.executablePath && plan.gameRootBlock?.reason !== "missing-files") {
        const candidateRoot = await deps
          .findGameRootFromExe(game.executablePath)
          .catch(() => null);
        if (!candidateRoot) {
          return {
            status: "blocked",
            blockReason: "unsafe-path",
            message: path.dirname(game.executablePath),
          };
        }

        const validation = await validateUninstallDirectory(
          candidateRoot,
          game,
          allGames,
          safetyContext
        );
        if (!validation.valid || !validation.resolvedPath) {
          return {
            status: "blocked",
            blockReason: validation.block?.reason ?? "unsafe-path",
            message: validation.block?.details,
          };
        }

        const downloadFolder = await resolveDownloadFolder(download);
        const overlapsGameRoot = Boolean(
          downloadFolder.path &&
            (normalizeComparablePath(downloadFolder.path, deps.platform) ===
              normalizeComparablePath(validation.resolvedPath, deps.platform) ||
              isPathWithin(
                downloadFolder.path,
                validation.resolvedPath,
                deps.platform
              ))
        );

        await deps.deleteDirectory(validation.resolvedPath);

        await runPostUninstallCleanup(shop, objectId, {
          ...cleanupFlags,
          deleteDownloadFolder:
            cleanupFlags.deleteDownloadFolder || overlapsGameRoot,
        });

        return { status: "uninstalled" };
      }

      // Missing executable on disk: clear stale metadata and run requested cleanup.
      await runPostUninstallCleanup(shop, objectId, cleanupFlags);
      return { status: "uninstalled" };
    } catch (error) {
      deps.logError?.(
        `[GameUninstall] Failed to uninstall ${shop}:${objectId}`,
        error
      );
      throw error;
    } finally {
      activeUninstalls.delete(key);
    }
  };

  return {
    inspectGameUninstall,
    executeGameUninstall,
  };
};
