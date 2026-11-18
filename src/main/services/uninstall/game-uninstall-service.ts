import { app, shell } from "electron";
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import type { Game, GameShop, NativeUninstallerInfo } from "@types";
import { downloadsSublevel, gamesSublevel, levelKeys } from "@main/level";
import {
  logger,
  SystemPath,
  Umu,
  Wine,
  WindowManager,
} from "@main/services";
import { isGameRunning } from "@main/services/game-running-state";
import { hasManagedEpicSession } from "@main/services/epic/launch";
import { getSteamLibraryFolders } from "@main/services/steam";
import { updateGameRecord } from "@main/services/game-record-updater";
import { updateGameExecutablePath } from "@main/helpers/update-executable-path";
import { findSourceArchiveFile } from "@main/helpers/find-game-installer";
import { isInstallerRunLive } from "@main/helpers/installed-executable-poller";
import { removeLibraryGame } from "@main/helpers/remove-library-game";
import { getDownloadsPath } from "@main/events/helpers/get-downloads-path";
import { findGameRootFromExe } from "@main/events/helpers/find-game-root";
import { getDirectorySize } from "@main/events/helpers/get-directory-size";
import { deleteGameFolderForGame } from "@main/events/library/delete-game-folder";
import { isGameTransferring } from "@main/events/library/transfer-game-files";
import { isLibraryGameDownloading } from "@shared";
import { createGameUninstallCore } from "./game-uninstall-core";
import { detectNativeUninstaller } from "./windows-uninstaller";

const UAC_DECLINED_EXIT_CODE = 1223;
const ELEVATION_ERROR_CODES = new Set(["EACCES", "UNKNOWN"]);
const UNINSTALL_STARTED_MARKER = "HYDRA_UNINSTALLER_STARTED";
const UNINSTALL_EXIT_MARKER = "HYDRA_UNINSTALLER_EXIT=";
const EXECUTABLE_WATCH_INTERVAL_MS = 1500;
const EXECUTABLE_WATCH_TIMEOUT_MS = 5 * 60_000;
const POST_EXIT_GRACE_MS = 2500;

const ELEVATED_UNINSTALLER_COMMAND = [
  "$ErrorActionPreference = 'Stop'",
  "try {",
  "$info = New-Object System.Diagnostics.ProcessStartInfo",
  "$info.FileName = $env:HYDRA_UNINSTALLER_PATH",
  "$info.WorkingDirectory = $env:HYDRA_UNINSTALLER_CWD",
  "$rawArgs = $env:HYDRA_UNINSTALLER_ARGS_JSON",
  "if ($rawArgs) {",
  "  $parsedArgs = @($rawArgs | ConvertFrom-Json)",
  "  if ($parsedArgs.Count -gt 0) {",
  "    $escaped = $parsedArgs | ForEach-Object {",
  "      $s = [string]$_",
  "      if ($s -match '[\\s\"]') { '\"' + ($s -replace '\"', '\\\"') + '\"' } else { $s }",
  "    }",
  "    $info.Arguments = ($escaped -join ' ')",
  "  }",
  "}",
  "$info.Verb = 'runas'",
  "$info.UseShellExecute = $true",
  "$proc = [System.Diagnostics.Process]::Start($info)",
  `Write-Output '${UNINSTALL_STARTED_MARKER}'`,
  `if ($proc) { $proc.WaitForExit(); Write-Output ('${UNINSTALL_EXIT_MARKER}' + $proc.ExitCode) }`,
  "} catch {",
  "$failure = $_.Exception.GetBaseException()",
  `if ($failure.NativeErrorCode -eq ${UAC_DECLINED_EXIT_CODE}) { Write-Output '${UNINSTALL_EXIT_MARKER}${UAC_DECLINED_EXIT_CODE}' } else { Write-Output $failure.Message }`,
  "}",
].join("; ");

const activeExecutableWatchers = new Map<string, () => void>();

const watchExecutableRemoved = (
  gameKey: string,
  executablePath: string,
  onRemoved: () => Promise<void>
) => {
  activeExecutableWatchers.get(gameKey)?.();

  let settled = false;
  let timer: NodeJS.Timeout | null = null;
  let deadlineTimer: NodeJS.Timeout | null = null;

  const stop = () => {
    if (timer) clearInterval(timer);
    if (deadlineTimer) clearTimeout(deadlineTimer);
    activeExecutableWatchers.delete(gameKey);
  };

  const checkRemoved = async () => {
    if (settled) return;
    const exists = await fs.promises
      .lstat(executablePath)
      .then(() => true)
      .catch(() => false);
    if (exists) return;

    settled = true;
    stop();
    try {
      await onRemoved();
    } catch (error) {
      logger.error(
        `[GameUninstall] Failed post-uninstall cleanup for ${gameKey}`,
        error
      );
    }
  };

  timer = setInterval(() => {
    void checkRemoved();
  }, EXECUTABLE_WATCH_INTERVAL_MS);
  timer.unref();

  deadlineTimer = setTimeout(() => {
    stop();
  }, EXECUTABLE_WATCH_TIMEOUT_MS);
  deadlineTimer.unref();

  activeExecutableWatchers.set(gameKey, stop);

  return {
    notifyExited: () => {
      // Inno Setup copies itself to %TEMP% and exits the original exe early.
      const graceTimer = setTimeout(() => {
        void checkRemoved();
      }, POST_EXIT_GRACE_MS);
      graceTimer.unref();
    },
    cancel: stop,
  };
};

const launchWindowsUninstaller = async (
  uninstaller: NativeUninstallerInfo,
  gameRoot: string,
  onStarted: () => { notifyExited: () => void; cancel: () => void }
): Promise<"launched" | "cancelled"> => {
  const direct = await new Promise<{
    spawned: boolean;
    errorCode: string | null;
  }>((resolve) => {
    try {
      const child = spawn(uninstaller.executablePath, uninstaller.args, {
        cwd: gameRoot,
        shell: false,
        detached: true,
        stdio: "ignore",
      });

      let watcher: ReturnType<typeof onStarted> | null = null;

      child.once("spawn", () => {
        watcher = onStarted();
        child.once("close", () => watcher?.notifyExited());
        child.unref();
        resolve({ spawned: true, errorCode: null });
      });

      child.once("error", (error: NodeJS.ErrnoException) => {
        watcher?.cancel();
        resolve({ spawned: false, errorCode: error.code ?? null });
      });
    } catch (error) {
      resolve({
        spawned: false,
        errorCode: (error as NodeJS.ErrnoException).code ?? null,
      });
    }
  });

  if (direct.spawned) return "launched";

  if (direct.errorCode && ELEVATION_ERROR_CODES.has(direct.errorCode)) {
    return await new Promise<"launched" | "cancelled">((resolve) => {
      let output = "";
      let resolved = false;
      const watcher = onStarted();

      const child = spawn(
        "powershell.exe",
        [
          "-NoProfile",
          "-NonInteractive",
          "-ExecutionPolicy",
          "Bypass",
          "-Command",
          ELEVATED_UNINSTALLER_COMMAND,
        ],
        {
          stdio: ["ignore", "pipe", "pipe"],
          shell: false,
          windowsHide: true,
          env: {
            ...process.env,
            HYDRA_UNINSTALLER_PATH: uninstaller.executablePath,
            HYDRA_UNINSTALLER_CWD: gameRoot,
            HYDRA_UNINSTALLER_ARGS_JSON: JSON.stringify(uninstaller.args),
          },
        }
      );

      child.stdout?.on("data", (chunk: Buffer) => {
        output += chunk.toString();
        if (!resolved && output.includes(UNINSTALL_STARTED_MARKER)) {
          resolved = true;
          resolve("launched");
        }
      });
      child.stderr?.on("data", (chunk: Buffer) => {
        output += chunk.toString();
      });

      child.once("close", () => {
        const exitMatch = new RegExp(`${UNINSTALL_EXIT_MARKER}(\\d+)`).exec(
          output
        );
        const exitCode = exitMatch ? Number(exitMatch[1]) : null;
        if (exitCode === UAC_DECLINED_EXIT_CODE) {
          watcher.cancel();
          if (!resolved) {
            resolved = true;
            resolve("cancelled");
          }
          return;
        }

        if (!resolved) {
          resolved = true;
          if (output.includes(UNINSTALL_STARTED_MARKER)) {
            resolve("launched");
          } else {
            watcher.cancel();
            resolve("cancelled");
          }
        }
        watcher.notifyExited();
      });

      child.once("error", () => {
        watcher.cancel();
        if (!resolved) {
          resolved = true;
          resolve("cancelled");
        }
      });
    });
  }

  const openError = await shell.openPath(uninstaller.executablePath);
  if (openError.length === 0) {
    onStarted();
    return "launched";
  }

  return "cancelled";
};

const launchLinuxUninstaller = async (
  uninstaller: NativeUninstallerInfo,
  gameRoot: string,
  game: Game,
  onStarted: () => { notifyExited: () => void; cancel: () => void }
): Promise<"launched" | "cancelled"> => {
  const winePrefixPath = Wine.getEffectivePrefixPath(
    game.winePrefixPath,
    game.objectId
  );
  const watcher = onStarted();

  try {
    await Umu.launchExecutable(uninstaller.executablePath, uninstaller.args, {
      gameId: game.objectId,
      winePrefixPath,
      protonPath: game.protonPath,
      onExit: () => watcher.notifyExited(),
    });
    return "launched";
  } catch (error) {
    logger.warn(
      "[GameUninstall] Failed to launch uninstaller via umu-run, falling back to wine",
      error
    );
  }

  return await new Promise<"launched" | "cancelled">((resolve) => {
    try {
      const child = spawn(
        "wine",
        [uninstaller.executablePath, ...uninstaller.args],
        {
          cwd: gameRoot,
          shell: false,
          detached: true,
          stdio: "ignore",
          env: winePrefixPath
            ? { ...process.env, WINEPREFIX: winePrefixPath }
            : process.env,
        }
      );

      child.once("spawn", () => {
        child.once("close", () => watcher.notifyExited());
        child.unref();
        resolve("launched");
      });

      child.once("error", () => {
        watcher.cancel();
        resolve("cancelled");
      });
    } catch {
      watcher.cancel();
      resolve("cancelled");
    }
  });
};

const getProtectedRoots = async (): Promise<string[]> => {
  const safeAppPath = (name: Parameters<typeof app.getPath>[0]) => {
    try {
      return app.getPath(name);
    } catch {
      return "";
    }
  };

  const [downloadsPath, steamFolders] = await Promise.all([
    getDownloadsPath().catch(() => ""),
    getSteamLibraryFolders().catch(() => [] as string[]),
  ]);

  const steamRoots = steamFolders.flatMap((folder) => [
    folder,
    path.join(folder, "steamapps"),
    path.join(folder, "steamapps", "common"),
  ]);

  const wineDefaultRoot = Wine.getDefaultPrefixPath() ?? "";
  const wineLegacyRoot = Wine.getLegacyDefaultPrefixPath() ?? "";

  return [
    SystemPath.getPath("home"),
    SystemPath.getPath("desktop"),
    SystemPath.getPath("documents"),
    SystemPath.getPath("downloads"),
    SystemPath.getPath("appData"),
    SystemPath.getPath("userData"),
    SystemPath.getPath("temp"),
    safeAppPath("music"),
    safeAppPath("pictures"),
    safeAppPath("videos"),
    safeAppPath("exe") ? path.dirname(safeAppPath("exe")) : "",
    downloadsPath,
    wineDefaultRoot,
    wineLegacyRoot,
    ...steamRoots,
  ].filter(Boolean);
};

export const gameUninstallService = createGameUninstallCore({
  platform: process.platform,
  getGame: (shop, objectId) =>
    gamesSublevel.get(levelKeys.game(shop, objectId)).catch(() => undefined),
  getAllGames: () => gamesSublevel.values().all(),
  getDownload: (shop, objectId) =>
    downloadsSublevel
      .get(levelKeys.game(shop, objectId))
      .catch(() => undefined),
  getDownloadsPath,
  getSafetyContext: async () => ({
    platform: process.platform,
    protectedRoots: await getProtectedRoots(),
  }),
  findGameRootFromExe,
  getDirectorySize,
  hasSourceArchive: async (download) =>
    (await findSourceArchiveFile(download)) !== null,
  detectNativeUninstaller: (gameRoot, executablePath) =>
    detectNativeUninstaller(gameRoot, executablePath, process.platform),
  isGameRunning: (shop, objectId) => {
    const key = levelKeys.game(shop, objectId);
    return isGameRunning(objectId, shop) || hasManagedEpicSession(key);
  },
  isGameDownloading: (download) => isLibraryGameDownloading({ download }),
  isGameTransferring,
  isInstallerRunning: (shop, objectId, download) => {
    const key = levelKeys.game(shop, objectId);
    return Boolean(download?.installerRunning) || isInstallerRunLive(key);
  },
  getEffectiveWinePrefix: (game) =>
    Wine.getEffectivePrefixPath(game.winePrefixPath, game.objectId),
  legacyDefaultWinePrefixPath: Wine.getLegacyDefaultPrefixPath(),
  homeDir: SystemPath.getPath("home"),
  envWinePrefix: process.env.WINEPREFIX ?? null,
  validateWinePrefix: (prefixPath) => Wine.validatePrefix(prefixPath),
  deleteDirectory: (dirPath) =>
    fs.promises.rm(dirPath, {
      recursive: true,
      force: true,
      maxRetries: 5,
      retryDelay: 200,
    }),
  deleteDownloadFolder: (shop, objectId, options) =>
    deleteGameFolderForGame(shop, objectId, options),
  clearGameInstallationFields: async (shop, objectId, options) => {
    const gameKey = levelKeys.game(shop, objectId);
    await updateGameRecord(gameKey, (current) => ({
      ...updateGameExecutablePath(current, null),
      trackingExecutablePaths: [],
      trackingExecutablePathsUpdatedAt: null,
      installedSizeInBytes: null,
      automaticCloudSync: false,
      ...(options.clearWinePrefix ? { winePrefixPath: null } : {}),
    }));
  },
  removeFromLibrary: async (shop: GameShop, objectId: string) => {
    await removeLibraryGame(shop, objectId);
  },
  launchNativeUninstaller: async ({
    shop,
    objectId,
    uninstaller,
    gameRoot,
    executablePath,
    game,
    onUninstallCompleted,
  }) => {
    const gameKey = levelKeys.game(shop, objectId);
    const startWatcher = () =>
      watchExecutableRemoved(gameKey, executablePath, onUninstallCompleted);

    if (process.platform === "win32") {
      return launchWindowsUninstaller(uninstaller, gameRoot, startWatcher);
    }

    if (process.platform === "linux") {
      return launchLinuxUninstaller(
        uninstaller,
        gameRoot,
        game,
        startWatcher
      );
    }

    const openError = await shell.openPath(uninstaller.executablePath);
    if (openError.length === 0) {
      startWatcher();
      return "launched";
    }
    return "cancelled";
  },
  notifyLibraryUpdated: () => {
    WindowManager.sendToAppWindows("on-library-batch-complete");
  },
  logError: (message, error) => logger.error(message, error),
});
