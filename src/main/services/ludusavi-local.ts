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
  LudusaviLocalSettings,
  LudusaviLocalResult,
  LudusaviLocalState,
} from "@types";
import { SystemPath } from "./system-path";
import { NativeAddon, type SystemProcessMap } from "./native-addon";
import { logger } from "./logger";
import {
  LudusaviExitTracker,
  matchesLocalGame,
  type TrackedLocalGame,
} from "./ludusavi-local-tracker";
import { LudusaviBackupQueue } from "./ludusavi-local-queue";

const exec = promisify(execFile);
const settingsKey = "ludusaviLocalSettings";
const historyKey = "ludusaviLocalHistory";
const tracker = new LudusaviExitTracker();
const queue = new LudusaviBackupQueue();
let busy = false;
const folder = () =>
  path.join(SystemPath.getPath("userData"), "ludusavi-local");
const logPath = () => path.join(folder(), "backup.log");
const keyOf = (game: Game) => levelKeys.game(game.shop, game.objectId);

const defaults = (): LudusaviLocalSettings => ({
  enabled: false,
  destination: path.join(
    process.env.OneDriveConsumer || path.join(os.homedir(), "OneDrive"),
    "Games Data",
    "ludusavi-backup"
  ),
  fullRetention: 10,
  exitDelaySeconds: 10,
  games: {},
});

export const getLudusaviLocalSettings =
  async (): Promise<LudusaviLocalSettings> => ({
    ...defaults(),
    ...(await db.get<string, LudusaviLocalSettings>(settingsKey, {
      valueEncoding: "json",
    })),
  });

export const saveLudusaviLocalSettings = async (
  value: LudusaviLocalSettings
) => {
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
    typeof value.games !== "object"
  ) {
    throw new Error(t("ludusavi:invalid_settings"));
  }
  for (const game of Object.values(value.games)) {
    if (
      typeof game.enabled !== "boolean" ||
      !Array.isArray(game.savePaths) ||
      !Array.isArray(game.trackingPaths) ||
      [...game.savePaths, ...game.trackingPaths].some(
        (p) => typeof p !== "string" || !path.isAbsolute(p) || /[?*]/.test(p)
      )
    )
      throw new Error(t("ludusavi:invalid_settings"));
  }
  await db.put(settingsKey, value, { valueEncoding: "json" });
  if (!value.enabled) tracker.reset();
  return getLudusaviLocalState();
};

export const getLudusaviLocalState = async (): Promise<LudusaviLocalState> => {
  const [settings, history, games] = await Promise.all([
    getLudusaviLocalSettings(),
    db.get<string, LudusaviLocalResult[]>(historyKey, {
      valueEncoding: "json",
    }),
    gamesSublevel.values().all(),
  ]);
  return {
    settings,
    history: history ?? [],
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

const prepareConfig = async (game: Game, settings: LudusaviLocalSettings) => {
  const configDir = path.join(folder(), "config");
  await fs.mkdir(configDir, { recursive: true });
  const binary = path.join(
    app.isPackaged ? process.resourcesPath : app.getAppPath(),
    "ludusavi",
    process.platform === "win32" ? "ludusavi.exe" : "ludusavi"
  );
  const standalone = path.join(SystemPath.getPath("appData"), "ludusavi");
  let original: {
    roots?: unknown[];
    customGames?: {
      name: string;
      files?: string[];
      registry?: string[];
      integration?: string;
    }[];
  } = {};
  try {
    original =
      YAML.parse(
        await fs.readFile(path.join(standalone, "config.yaml"), "utf8")
      ) ?? {};
  } catch {
    /* Standalone Ludusavi is optional. */
  }
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
  if (game.shop === "steam" && /^\d+$/.test(game.objectId)) {
    const candidates = [
      ...["RUNE", "CODEX", "FLT"].map((provider) =>
        path.join(
          process.env.PUBLIC || "C:\\Users\\Public",
          "Documents",
          "Steam",
          provider,
          game.objectId
        )
      ),
      ...["Goldberg SteamEmu Saves", "GSE Saves"].map((provider) =>
        path.join(SystemPath.getPath("appData"), provider, game.objectId)
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
      YAML.stringify({
        manifest: { enable: true },
        roots,
        backup: {
          path: settings.destination,
          retention: { full: settings.fullRetention, differential: 0 },
        },
        cloud: { synchronize: false },
        customGames,
      })
    );
  await writeConfig();
  const lookupArgs = [
    "--config",
    configDir,
    "--try-manifest-update",
    "find",
    "--api",
    "--normalized",
  ];
  if (game.shop === "steam" && /^\d+$/.test(game.objectId))
    lookupArgs.push("--steam-id", game.objectId);
  lookupArgs.push(game.title);
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
    canonical = game.title;
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
      name: canonical,
      integration: "extend",
      files: [...new Set([...(previous?.files ?? []), ...configuredPaths])],
      registry: previous?.registry ?? [],
    });
    await writeConfig();
  }
  return { binary, configDir, canonical };
};

const record = async (result: LudusaviLocalResult) => {
  if (result.status === "failed") {
    logger.error("[Ludusavi Local] Backup failed", {
      title: result.title,
      message: result.message,
    });
    if (Notification.isSupported())
      new Notification({
        title: t("ludusavi:failure_title"),
        body: `${result.title}: ${result.message}`,
      }).show();
  }
  const history =
    (await db.get<string, LudusaviLocalResult[]>(historyKey, {
      valueEncoding: "json",
    })) ?? [];
  await db.put(historyKey, [result, ...history].slice(0, 50), {
    valueEncoding: "json",
  });
  await fs.mkdir(folder(), { recursive: true });
  if (
    await fs
      .stat(logPath())
      .then((s) => s.size > 2 * 1024 * 1024)
      .catch(() => false)
  )
    await fs.rename(logPath(), `${logPath()}.old`).catch(() => undefined);
  await fs.appendFile(logPath(), `${JSON.stringify(result)}\n`);
  return result;
};

const run = async (game: Game, preview: boolean, automatic: boolean) => {
  busy = true;
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
  let lock: Awaited<ReturnType<typeof fs.open>> | undefined;
  let lockFile: string | undefined;
  try {
    const settings = await getLudusaviLocalSettings();
    if (
      automatic &&
      (!settings.enabled || settings.games[keyOf(game)]?.enabled === false)
    )
      return;
    await assertStopped(game, settings);
    const { binary, configDir, canonical } = await prepareConfig(
      game,
      settings
    );
    if (!preview) {
      await fs.mkdir(settings.destination, { recursive: true });
      lockFile = path.join(settings.destination, ".hydra-ludusavi.lock");
      try {
        lock = await fs.open(lockFile, "wx");
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
        const owner = JSON.parse(await fs.readFile(lockFile, "utf8"));
        if (owner.host !== os.hostname() || !Number.isInteger(owner.pid))
          throw new Error(t("ludusavi:backup_locked"));
        const alive = [owner.pid, owner.childPid].some((pid) => {
          if (!Number.isInteger(pid) || pid < 1) return false;
          try {
            process.kill(pid, 0);
            return true;
          } catch (e) {
            return (e as NodeJS.ErrnoException).code !== "ESRCH";
          }
        });
        if (alive) throw new Error(t("ludusavi:backup_locked"));
        await fs.unlink(lockFile);
        lock = await fs.open(lockFile, "wx");
      }
      await lock.writeFile(
        JSON.stringify({ host: os.hostname(), pid: process.pid })
      );
    }
    await assertStopped(game, settings);
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
      "zip",
      "--full-limit",
      String(settings.fullRetention),
      "--differential-limit",
      "0",
    ];
    if (preview) args.push("--preview");
    const operation = exec(binary, args, {
      windowsHide: true,
      timeout: 10 * 60_000,
      maxBuffer: 32 * 1024 * 1024,
    });
    if (lock && operation.child.pid) {
      await lock
        .write(
          JSON.stringify({
            host: os.hostname(),
            pid: process.pid,
            childPid: operation.child.pid,
          }),
          0,
          "utf8"
        )
        .catch((error) =>
          logger.warn(
            "[Ludusavi Local] Could not persist backup child identity",
            error
          )
        );
    }
    const response = await operation;
    const data = JSON.parse(response.stdout);
    const scanned = data.games?.[canonical];
    if (
      !scanned ||
      scanned.decision !== "Processed" ||
      data.errors ||
      Object.values(scanned.files ?? {}).some(
        (f) => (f as { error?: unknown })?.error
      ) ||
      Object.values(scanned.registry ?? {}).some(
        (f) => (f as { error?: unknown })?.error
      )
    )
      throw new Error(t("ludusavi:incomplete_backup"));
    result.filePaths = Object.keys(scanned.files ?? {});
    result.files = result.filePaths.length;
    result.registryKeys = Object.keys(scanned.registry ?? {}).length;
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
    if (lock) {
      await lock.close();
      await fs.unlink(lockFile!).catch(() => undefined);
    }
    busy = false;
  }
  return record(result);
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
