import { app, Notification, shell } from "electron";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import YAML from "yaml";
import { t } from "i18next";
import { db } from "../level/level";
import { gamesSublevel } from "../level/sublevels/games";
import { levelKeys } from "../level/sublevels/keys";
import type {
  Game,
  LudusaviBulkBackupProgress,
  LudusaviBulkBackupOutcomeItem,
  LudusaviGameBackupSummary,
  LudusaviGameSettings,
  LudusaviLocalSettings,
  LudusaviLocalResult,
  LudusaviLocalState,
  SaveBackupVersion,
} from "@types";
import { SystemPath } from "./system-path";
import { NativeAddon, type SystemProcessMap } from "./native-addon";
import { logger } from "./logger";
import { WindowManager } from "./window-manager";
import { acquireSaveBackupLock } from "./ludusavi-local-lock";
import {
  applyLudusaviResultToSummary,
  backfillBackupSummaryFromVersions,
  classifyBulkBackupOutcome,
} from "./ludusavi-local-summary";
import {
  assertSaveApiSuccess,
  type SaveApiResponse,
} from "./ludusavi-local-api";
import {
  managedSaveConfig,
  parseSaveEngineConfig,
  type SaveEngineConfig,
} from "./ludusavi-local-config";
import {
  LudusaviExitTracker,
  matchesLocalGame,
  type TrackedLocalGame,
} from "./ludusavi-local-tracker";
import { LudusaviBackupQueue } from "./ludusavi-local-queue";
import {
  appendLudusaviBackupLog,
  clearLudusaviBackupLogs,
} from "./ludusavi-local-log";

const exec = promisify(execFile);
const settingsKey = "ludusaviLocalSettings";
const historyKey = "ludusaviLocalHistory";
const summariesKey = "ludusaviLocalGameSummaries";
const tracker = new LudusaviExitTracker();
const queue = new LudusaviBackupQueue();
let busy = false;
let activeGameKey: string | null = null;
let bulkProgress: LudusaviBulkBackupProgress = {
  running: false,
  total: 0,
  completed: 0,
  succeeded: 0,
  skipped: 0,
  failed: 0,
  currentGameKey: null,
  currentGameTitle: null,
  lastSummary: null,
};
let activeBulkRun: Promise<LudusaviBulkBackupProgress> | null = null;
const folder = () =>
  path.join(SystemPath.getPath("userData"), "ludusavi-local");
const logPath = () => path.join(folder(), "backup.log");
const keyOf = (game: Game) => levelKeys.game(game.shop, game.objectId);

const notifyStateChanged = () => {
  const mainWindow = WindowManager.mainWindow;
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send("on-ludusavi-state-changed");
  }
};

const defaults = (): LudusaviLocalSettings => ({
  enabled: true,
  destination: path.join(
    process.env.OneDriveConsumer || path.join(os.homedir(), "OneDrive"),
    "Games Data",
    "ludusavi-backup"
  ),
  fullRetention: 10,
  exitDelaySeconds: 10,
  games: {},
  differentialRetention: 0,
  format: "zip",
  compression: "deflate",
});

export const getLudusaviLocalSettings =
  async (): Promise<LudusaviLocalSettings> => ({
    ...defaults(),
    ...(await db.get<string, LudusaviLocalSettings>(settingsKey, {
      valueEncoding: "json",
    })),
  });

const validateLudusaviGameSettings = (game: LudusaviGameSettings) => {
  if (
    !game ||
    typeof game.enabled !== "boolean" ||
    !Array.isArray(game.savePaths) ||
    !Array.isArray(game.trackingPaths) ||
    (game.manifestTitle !== undefined &&
      (typeof game.manifestTitle !== "string" ||
        !game.manifestTitle.trim() ||
        game.manifestTitle.length > 1000)) ||
    (game.steamId !== undefined &&
      (typeof game.steamId !== "string" ||
        !/^\d+$/.test(game.steamId) ||
        Number(game.steamId) < 1 ||
        Number(game.steamId) > 4294967295)) ||
    [...game.savePaths, ...game.trackingPaths].some(
      (p) => typeof p !== "string" || !path.isAbsolute(p) || /[?*]/.test(p)
    )
  ) {
    throw new Error(t("ludusavi:invalid_settings"));
  }
};

const validateLudusaviSettings = (value: LudusaviLocalSettings) => {
  if (
    !value ||
    typeof value.enabled !== "boolean" ||
    !path.isAbsolute(value.destination || "") ||
    !Number.isInteger(value.fullRetention) ||
    value.fullRetention < 1 ||
    value.fullRetention > 255 ||
    !Number.isInteger(value.exitDelaySeconds) ||
    value.exitDelaySeconds < 5 ||
    value.exitDelaySeconds > 300 ||
    !value.games ||
    typeof value.games !== "object" ||
    (value.differentialRetention !== undefined &&
      (!Number.isInteger(value.differentialRetention) ||
        value.differentialRetention < 0 ||
        value.differentialRetention > 255)) ||
    (value.format !== undefined && !["zip", "simple"].includes(value.format)) ||
    (value.compression !== undefined &&
      !["none", "deflate", "bzip2", "zstd"].includes(value.compression))
  ) {
    throw new Error(t("ludusavi:invalid_settings"));
  }
  for (const game of Object.values(value.games)) {
    validateLudusaviGameSettings(game);
  }
};

export const saveLudusaviLocalSettings = async (
  value: LudusaviLocalSettings
) => {
  validateLudusaviSettings(value);
  if (queue.busy) throw new Error(t("ludusavi:clear_busy"));
  return queue.enqueue("settings:save", async () => {
    await db.put(settingsKey, value, { valueEncoding: "json" });
    if (!value.enabled) tracker.reset();
    notifyStateChanged();
    return getLudusaviLocalState();
  });
};

export const saveLudusaviGameSettings = async (
  gameKey: string,
  patch: Partial<LudusaviGameSettings>
) => {
  if (!gameKey || typeof gameKey !== "string") {
    throw new Error(t("ludusavi:invalid_settings"));
  }
  if (queue.busy) throw new Error(t("ludusavi:clear_busy"));
  return queue.enqueue(`settings:save-game:${gameKey}`, async () => {
    const current = await getLudusaviLocalSettings();
    const existingGame: LudusaviGameSettings = current.games[gameKey] ?? {
      enabled: true,
      savePaths: [],
      trackingPaths: [],
    };
    const mergedGame: LudusaviGameSettings = {
      ...existingGame,
      ...patch,
    };
    if (patch.manifestTitle === undefined && "manifestTitle" in patch) {
      delete mergedGame.manifestTitle;
    }
    if (patch.steamId === undefined && "steamId" in patch) {
      delete mergedGame.steamId;
    }
    validateLudusaviGameSettings(mergedGame);
    const next: LudusaviLocalSettings = {
      ...current,
      games: {
        ...current.games,
        [gameKey]: mergedGame,
      },
    };
    await db.put(settingsKey, next, { valueEncoding: "json" });
    notifyStateChanged();
    return getLudusaviLocalState();
  });
};

const deriveSummariesFromHistory = (
  history: LudusaviLocalResult[],
  stored: Record<string, LudusaviGameBackupSummary>
) => {
  const merged: Record<string, LudusaviGameBackupSummary> = { ...stored };
  for (let index = history.length - 1; index >= 0; index--) {
    const entry = history[index];
    if (!entry?.gameKey || stored[entry.gameKey]) continue;
    const updated = applyLudusaviResultToSummary(merged[entry.gameKey], entry);
    if (updated) {
      merged[entry.gameKey] = updated;
    }
  }
  return merged;
};

export const getLudusaviLocalState = async (): Promise<LudusaviLocalState> => {
  const [settings, history, rawSummaries, games] = await Promise.all([
    getLudusaviLocalSettings(),
    db.get<string, LudusaviLocalResult[]>(historyKey, {
      valueEncoding: "json",
    }),
    db.get<string, Record<string, LudusaviGameBackupSummary>>(summariesKey, {
      valueEncoding: "json",
    }),
    gamesSublevel.values().all(),
  ]);
  const resolvedHistory = history ?? [];
  const gameSummaries = deriveSummariesFromHistory(
    resolvedHistory,
    rawSummaries ?? {}
  );
  return {
    settings,
    history: resolvedHistory,
    gameSummaries,
    activeGameKey,
    bulkProgress,
    busy: busy || queue.busy,
    logPath: logPath(),
    games: games
      .filter((g) => !g.isDeleted)
      .map((g) => ({
        key: keyOf(g),
        title: g.title,
        executablePath: g.executablePath ?? null,
      })),
  };
};

export const clearLudusaviLocalLogs = () => {
  if (busy || queue.busy) throw new Error(t("ludusavi:clear_busy"));
  return queue.enqueue("maintenance:clear-logs", async () => {
    await clearLudusaviBackupLogs(folder());
    await db.put(historyKey, [], { valueEncoding: "json" });
    notifyStateChanged();
  });
};

const trackingGame = (
  game: Game,
  settings: LudusaviLocalSettings
): TrackedLocalGame => ({
  key: keyOf(game),
  paths: [
    game.executablePath,
    ...(game.trackingExecutablePaths ?? []),
    ...(settings.games[keyOf(game)]?.trackingPaths ?? []),
  ].filter((p): p is string => !!p),
});

const assertStopped = async (game: Game, settings: LudusaviLocalSettings) => {
  if (!trackingGame(game, settings).paths.length)
    throw new Error(t("ludusavi:process_unknown"));
  const scan = await NativeAddon.getSystemProcessMap();
  if (!scan?.processTree?.length)
    throw new Error(t("ludusavi:process_unknown"));
  const tracked = trackingGame(game, settings);
  // An exact match or another executable below the game's folder postpones
  // the backup, including descendants left behind by a bootstrap process.
  const gameFolders = tracked.paths.map((p) => path.dirname(p).toLowerCase());
  const running = scan.processTree.some(
    (p) =>
      matchesLocalGame(tracked, p) ||
      (!!p.exe &&
        gameFolders.some((dir) => {
          const relative = path.relative(dir, p.exe!.toLowerCase());
          return (
            relative !== ".." &&
            !relative.startsWith(`..${path.sep}`) &&
            !path.isAbsolute(relative)
          );
        }))
  );
  if (running) throw new Error(t("ludusavi:game_running"));
};

const binaryPath = () =>
  path.join(
    app.isPackaged ? process.resourcesPath : app.getAppPath(),
    "ludusavi",
    process.platform === "win32" ? "ludusavi.exe" : "ludusavi"
  );

const prepareBaseConfig = async (settings: LudusaviLocalSettings) => {
  const configDir = path.join(folder(), "config");
  await fs.mkdir(configDir, { recursive: true });
  const standalone = path.join(SystemPath.getPath("appData"), "ludusavi");
  let original: SaveEngineConfig = {};
  try {
    const source = parseSaveEngineConfig(
      await fs.readFile(path.join(standalone, "config.yaml"), "utf8")
    );
    original = { roots: source.roots, customGames: source.customGames };
  } catch {
    /* Standalone configuration is optional. */
  }
  let advanced: SaveEngineConfig = {};
  try {
    advanced = parseSaveEngineConfig(
      await fs.readFile(path.join(folder(), "advanced.yaml"), "utf8")
    );
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  const config = managedSaveConfig(
    {
      manifest: { enable: true },
      roots: original.roots ?? [
        {
          store: "steam",
          path: path.join(
            process.env["ProgramFiles(x86)"] || "C:\\Program Files (x86)",
            "Steam"
          ),
        },
      ],
      customGames: original.customGames ?? [],
      ...advanced,
    },
    settings
  );
  await fs.writeFile(
    path.join(configDir, "config.yaml"),
    YAML.stringify(config)
  );
  return { configDir, binary: binaryPath(), config, standalone };
};

const prepareConfig = async (
  game: Game,
  settings: LudusaviLocalSettings,
  updateManifest = true
) => {
  const { configDir, binary, config, standalone } =
    await prepareBaseConfig(settings);
  const original = config;
  try {
    await fs.copyFile(
      path.join(standalone, "manifest.yaml"),
      path.join(configDir, "manifest.yaml"),
      1
    );
  } catch {
    /* Keep our own manifest once initialized. */
  }
  const customGames = [...(original.customGames ?? [])];
  const roots = [
    ...(original.roots ?? [
      {
        store: "steam",
        path: path.join(
          process.env["ProgramFiles(x86)"] || "C:\\Program Files (x86)",
          "Steam"
        ),
      },
    ]),
  ];
  const steamLibrary = game.executablePath?.match(
    /^(.*)[\\/]steamapps[\\/]common[\\/]/i
  )?.[1];
  if (steamLibrary) roots.push({ store: "steam", path: steamLibrary });
  const configuredPaths = [...(settings.games[keyOf(game)]?.savePaths ?? [])];
  const linkedTitle = settings.games[keyOf(game)]?.manifestTitle;
  const saveSteamId =
    settings.games[keyOf(game)]?.steamId ??
    (game.shop === "steam" ? game.objectId : undefined);
  if (saveSteamId && /^\d+$/.test(saveSteamId)) {
    const candidates = [
      ...["RUNE", "CODEX", "FLT"].map((provider) =>
        path.join(
          process.env.PUBLIC || "C:\\Users\\Public",
          "Documents",
          "Steam",
          provider,
          saveSteamId
        )
      ),
      ...["Goldberg SteamEmu Saves", "GSE Saves"].map((provider) =>
        path.join(SystemPath.getPath("appData"), provider, saveSteamId)
      ),
    ];
    for (const candidate of candidates) {
      if (
        await fs
          .stat(candidate)
          .then((s) => s.isDirectory())
          .catch(() => false)
      )
        configuredPaths.push(candidate);
    }
  }
  const writeConfig = async () =>
    fs.writeFile(
      path.join(configDir, "config.yaml"),
      YAML.stringify({ ...config, roots, customGames })
    );
  await writeConfig();
  const lookupArgs = [
    "--config",
    configDir,
    updateManifest ? "--try-manifest-update" : "--no-manifest-update",
    "find",
    "--api",
    "--normalized",
  ];
  if (!linkedTitle && game.shop === "steam" && /^\d+$/.test(game.objectId))
    lookupArgs.push("--steam-id", game.objectId);
  lookupArgs.push("--", linkedTitle ?? game.title);
  let canonical: string;
  try {
    const result = await exec(binary, lookupArgs, {
      windowsHide: true,
      timeout: 120_000,
      maxBuffer: 4 * 1024 * 1024,
    });
    canonical = Object.keys(JSON.parse(result.stdout).games ?? {})[0];
  } catch {
    if (!configuredPaths.length)
      throw new Error(t("ludusavi:unrecognized_game", { game: game.title }));
    canonical = linkedTitle ?? game.title;
  }
  if (!canonical)
    throw new Error(t("ludusavi:unrecognized_game", { game: game.title }));
  if (configuredPaths.length) {
    for (const source of configuredPaths) {
      const relative = path.relative(source, settings.destination);
      if (
        !relative ||
        (!relative.startsWith(`..${path.sep}`) &&
          relative !== ".." &&
          !path.isAbsolute(relative))
      )
        throw new Error(t("ludusavi:destination_overlap"));
    }
    const existing = customGames.findIndex((g) => g.name === canonical);
    const previous = existing >= 0 ? customGames[existing] : undefined;
    if (existing >= 0) customGames.splice(existing, 1);
    customGames.push({
      ...previous,
      name: canonical,
      integration: previous?.integration ?? "extend",
      files: [...new Set([...(previous?.files ?? []), ...configuredPaths])],
      registry: previous?.registry ?? [],
    });
    await writeConfig();
  }
  return { binary, configDir, canonical };
};

const record = async (
  result: LudusaviLocalResult,
  options?: {
    suppressFailureNotification?: boolean;
    skipSummaryMessages?: string[];
  }
) => {
  if (result.status === "failed") {
    logger.error("[Ludusavi Local] Backup failed", {
      title: result.title,
      message: result.message,
    });
    if (!options?.suppressFailureNotification && Notification.isSupported())
      new Notification({
        title: t("ludusavi:failure_title"),
        body: `${result.title}: ${result.message}`,
      }).show();
  }
  const [history, storedSummaries] = await Promise.all([
    db.get<string, LudusaviLocalResult[]>(historyKey, {
      valueEncoding: "json",
    }),
    db.get<string, Record<string, LudusaviGameBackupSummary>>(summariesKey, {
      valueEncoding: "json",
    }),
  ]);
  await db.put(historyKey, [result, ...(history ?? [])].slice(0, 50), {
    valueEncoding: "json",
  });
  const isBulkSkip =
    result.status === "failed" &&
    !!options?.skipSummaryMessages?.some(
      (msg) => msg && result.message.toLowerCase().includes(msg.toLowerCase())
    );
  const nextSummary = isBulkSkip
    ? null
    : applyLudusaviResultToSummary(storedSummaries?.[result.gameKey], result);
  if (nextSummary) {
    await db.put(
      summariesKey,
      { ...(storedSummaries ?? {}), [result.gameKey]: nextSummary },
      { valueEncoding: "json" }
    );
  }
  await appendLudusaviBackupLog(folder(), result);
  notifyStateChanged();
  return result;
};

export const backfillGameBackupVersionSummary = async (
  gameKey: string,
  versions: Pick<SaveBackupVersion, "when">[]
) => {
  const storedSummaries =
    (await db.get<string, Record<string, LudusaviGameBackupSummary>>(
      summariesKey,
      { valueEncoding: "json" }
    )) ?? {};
  const nextSummary = backfillBackupSummaryFromVersions(
    storedSummaries[gameKey],
    versions
  );
  if (!nextSummary) return;
  await db.put(
    summariesKey,
    { ...storedSummaries, [gameKey]: nextSummary },
    { valueEncoding: "json" }
  );
  notifyStateChanged();
};

const run = async (
  game: Game,
  preview: boolean,
  automatic: boolean,
  options?: {
    suppressFailureNotification?: boolean;
    skipSummaryMessages?: string[];
  }
) => {
  busy = true;
  activeGameKey = keyOf(game);
  notifyStateChanged();
  const result: LudusaviLocalResult = {
    gameKey: keyOf(game),
    title: game.title,
    at: new Date().toISOString(),
    status: "failed",
    files: 0,
    bytes: 0,
    registryKeys: 0,
    filePaths: [],
    message: "",
    cloudSync: "not-verified",
  };
  let lock: Awaited<ReturnType<typeof acquireSaveBackupLock>> | undefined;
  try {
    const settings = await getLudusaviLocalSettings();
    if (
      automatic &&
      (!settings.enabled || settings.games[keyOf(game)]?.enabled === false)
    )
      return;
    const shouldCheckStopped =
      automatic || trackingGame(game, settings).paths.length > 0;
    if (shouldCheckStopped) {
      await assertStopped(game, settings);
    }
    lock = await acquireSaveBackupLock(settings.destination);
    const { binary, configDir, canonical } = await prepareConfig(
      game,
      settings
    );
    if (shouldCheckStopped) {
      await assertStopped(game, settings);
    }
    const args = [
      "--config",
      configDir,
      "--no-manifest-update",
      "backup",
      canonical,
      "--api",
      "--force",
      "--no-cloud-sync",
      "--path",
      settings.destination,
      "--format",
      settings.format ?? "zip",
      "--compression",
      settings.compression ?? "deflate",
      "--full-limit",
      String(settings.fullRetention),
      "--differential-limit",
      String(settings.differentialRetention ?? 0),
    ];
    if (preview) args.push("--preview");
    const operation = exec(binary, args, {
      windowsHide: true,
      timeout: 10 * 60_000,
      maxBuffer: 32 * 1024 * 1024,
    });
    if (lock) await lock.child(operation.child.pid);
    const response = await operation;
    const data = JSON.parse(response.stdout) as SaveApiResponse;
    assertSaveApiSuccess(data);
    const scanned = data.games?.[canonical];
    if (
      !scanned ||
      scanned.decision !== "Processed" ||
      (data.errors && Object.keys(data.errors).length > 0) ||
      Object.values(scanned.files ?? {}).some(
        (f) =>
          (f as { error?: unknown; failed?: boolean })?.error ||
          (f as { failed?: boolean })?.failed
      ) ||
      Object.values(scanned.registry ?? {}).some(
        (f) =>
          (f as { error?: unknown; failed?: boolean })?.error ||
          (f as { failed?: boolean })?.failed
      )
    )
      throw new Error(t("ludusavi:incomplete_backup"));
    result.filePaths = Object.entries(scanned.files ?? {})
      .filter(([, item]) => !item.ignored)
      .map(([file]) => file);
    result.files = result.filePaths.length;
    result.registryKeys = Object.values(scanned.registry ?? {}).filter(
      (item) => !item.ignored
    ).length;
    result.bytes = data.overall?.processedBytes ?? 0;
    if (!result.files && !result.registryKeys)
      throw new Error(t("ludusavi:no_saves"));
    result.status = preview ? "preview" : "success";
    result.message = t(
      preview ? "ludusavi:preview_complete" : "ludusavi:local_complete"
    );
  } catch (error) {
    result.message = error instanceof Error ? error.message : String(error);
  } finally {
    if (lock) await lock.release();
    busy = false;
    activeGameKey = null;
  }
  return record(result, options);
};

export const enqueueLudusaviLocalBackup = async (
  key: string,
  preview = false,
  automatic = false
) => {
  return queue.enqueue(JSON.stringify([key, preview]), async () => {
    const game = await gamesSublevel.get(key);
    if (!game || game.isDeleted)
      throw new Error(t("ludusavi:unrecognized_game"));
    return run(game, preview, automatic);
  });
};

export const runLudusaviLocalBulkBackup = async (
  includeDisabled = false
): Promise<LudusaviBulkBackupProgress> => {
  if (activeBulkRun) return activeBulkRun;
  if (queue.busy) throw new Error(t("ludusavi:clear_busy"));

  const task = (async () => {
    const [settings, allGames] = await Promise.all([
      getLudusaviLocalSettings(),
      gamesSublevel.values().all(),
    ]);
    const targets = allGames.filter(
      (g) =>
        !g.isDeleted &&
        (includeDisabled || settings.games[keyOf(g)]?.enabled !== false)
    );

    const skippedGames: LudusaviBulkBackupOutcomeItem[] = [];
    const failures: LudusaviBulkBackupOutcomeItem[] = [];
    const skipMessages = [t("ludusavi:game_running"), t("ludusavi:no_saves")];

    bulkProgress = {
      running: true,
      total: targets.length,
      completed: 0,
      succeeded: 0,
      skipped: 0,
      failed: 0,
      currentGameKey: null,
      currentGameTitle: null,
      lastSummary: bulkProgress.lastSummary,
    };
    notifyStateChanged();

    for (const game of targets) {
      const gameKey = keyOf(game);
      bulkProgress = {
        ...bulkProgress,
        currentGameKey: gameKey,
        currentGameTitle: game.title,
      };
      notifyStateChanged();

      try {
        const result = await queue.enqueue(
          JSON.stringify([gameKey, false]),
          async () => {
            const latestGame = await gamesSublevel.get(gameKey);
            if (!latestGame || latestGame.isDeleted) return undefined;
            return run(latestGame, false, false, {
              suppressFailureNotification: true,
              skipSummaryMessages: skipMessages,
            });
          }
        );

        const kind = classifyBulkBackupOutcome(result, skipMessages);
        if (kind === "succeeded") {
          bulkProgress = {
            ...bulkProgress,
            completed: bulkProgress.completed + 1,
            succeeded: bulkProgress.succeeded + 1,
          };
        } else if (kind === "skipped") {
          skippedGames.push({
            gameKey,
            title: game.title,
            reason: result?.message || t("ludusavi:no_saves"),
          });
          bulkProgress = {
            ...bulkProgress,
            completed: bulkProgress.completed + 1,
            skipped: bulkProgress.skipped + 1,
          };
        } else {
          failures.push({
            gameKey,
            title: game.title,
            reason: result?.message || t("ludusavi:failure_title"),
          });
          bulkProgress = {
            ...bulkProgress,
            completed: bulkProgress.completed + 1,
            failed: bulkProgress.failed + 1,
          };
        }
      } catch (error) {
        failures.push({
          gameKey,
          title: game.title,
          reason: error instanceof Error ? error.message : String(error),
        });
        bulkProgress = {
          ...bulkProgress,
          completed: bulkProgress.completed + 1,
          failed: bulkProgress.failed + 1,
        };
      }
      notifyStateChanged();
    }

    bulkProgress = {
      ...bulkProgress,
      running: false,
      currentGameKey: null,
      currentGameTitle: null,
      lastSummary: {
        finishedAt: new Date().toISOString(),
        total: targets.length,
        succeeded: bulkProgress.succeeded,
        skipped: bulkProgress.skipped,
        failed: bulkProgress.failed,
        skippedGames,
        failures,
      },
    };
    notifyStateChanged();
    return bulkProgress;
  })();

  activeBulkRun = task;
  try {
    return await task;
  } finally {
    if (activeBulkRun === task) activeBulkRun = null;
  }
};

export const observeLudusaviLocalGames = async (
  games: Game[],
  scan: Pick<SystemProcessMap, "processTree">
) => {
  const settings = await getLudusaviLocalSettings();
  if (!settings.enabled || process.platform !== "win32") {
    tracker.reset();
    return;
  }
  const configured = games
    .filter(
      (g) =>
        !g.isDeleted &&
        g.executablePath &&
        settings.games[keyOf(g)]?.enabled !== false
    )
    .map((g) => trackingGame(g, settings));
  for (const key of tracker.observe(
    configured,
    scan.processTree ?? null,
    Date.now(),
    settings.exitDelaySeconds * 1000
  )) {
    void enqueueLudusaviLocalBackup(key, false, true).catch((error) =>
      logger.error("[Ludusavi Local] Queue error", error)
    );
  }
};

export const openLudusaviLocalFolder = async (logs = false) => {
  const destination = logs
    ? folder()
    : (await getLudusaviLocalSettings()).destination;
  await fs.mkdir(destination, { recursive: true });
  return shell.openPath(destination);
};

export const waitForLudusaviLocalBackups = () => queue.drain();

/** Shared operations use this same queue, configuration and stop checks. */
export const localSaveTools = {
  queue,
  folder,
  binaryPath,
  prepareBaseConfig,
  prepareConfig,
  assertStopped,
  record,
  backfillGameBackupVersionSummary,
};
