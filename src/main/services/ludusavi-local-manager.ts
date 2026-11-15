import { app } from "electron";
import fs from "node:fs/promises";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import { REMOTE_SETUP_REQUIRED } from "../../shared/save-manager-errors";
import YAML from "yaml";
import type {
  Game,
  LudusaviLocalSettings,
  LudusaviLocalResult,
  SaveOperationResult,
} from "@types";
import { db } from "../level/level";
import { gamesSublevel } from "../level/sublevels/games";
import { SystemPath } from "./system-path";
import { getTrackedGamesRunning } from "./game-running-state";
import {
  localSaveTools as tools,
  getLudusaviLocalSettings,
} from "./ludusavi-local";
import { acquireSaveBackupLock } from "./ludusavi-local-lock";
import {
  assertSaveApiSuccess,
  savePreviewFiles,
  SaveOperationApprovals,
  type SaveApiResponse,
} from "./ludusavi-local-api";
import {
  managedSaveConfig,
  parseSaveEngineConfig,
} from "./ludusavi-local-config";
import {
  confinedSavePath,
  validateSaveVersion,
} from "./ludusavi-local-validation";

const execute = promisify(execFile);
const approvals = new SaveOperationApprovals();
type Lock = Awaited<ReturnType<typeof acquireSaveBackupLock>>;
type Context = Awaited<ReturnType<typeof tools.prepareConfig>> & {
  settings: LudusaviLocalSettings;
  game: Game;
  lock: Lock;
};

async function removeSaveScratch(directory: string) {
  const scratchRoot = await fs.realpath(path.join(tools.folder(), ".tmp"));
  const actual = await fs.realpath(directory);
  if (path.dirname(actual) !== scratchRoot)
    throw new Error(
      "Refusing to remove a temporary folder outside the save-tool scratch directory."
    );
  await fs.rm(actual, { recursive: true, force: true });
}

async function command(
  binary: string,
  args: string[],
  lock?: Lock,
  env?: NodeJS.ProcessEnv
) {
  const operation = execute(binary, args, {
    windowsHide: true,
    timeout: 10 * 60_000,
    maxBuffer: 32 * 1024 * 1024,
    env,
  });
  // With no game arguments, Ludusavi accepts names from stdin. Signal EOF so
  // whole-library scans do not wait indefinitely on an unused input pipe.
  operation.child.stdin?.end();
  // Attach rejection handling before asynchronous PID persistence.
  const handled = operation.catch(() => undefined);
  if (lock) {
    try {
      await lock.child(operation.child.pid);
    } catch (error) {
      operation.child.kill();
      await handled;
      throw error;
    }
  }
  try {
    const result = await operation;
    // Ludusavi 0.29 prints cloud --api JSON to stderr even on success.
    return result.stdout.trim() ? result.stdout : result.stderr;
  } catch {
    throw new Error(
      "The backup tool could not complete this command. Check configuration, storage access, and the selected data."
    );
  } finally {
    await handled;
  }
}

async function json(ctx: Context, args: string[]) {
  const data = JSON.parse(
    await command(
      ctx.binary,
      ["--config", ctx.configDir, "--no-manifest-update", ...args],
      ctx.lock
    )
  ) as SaveApiResponse;
  assertSaveApiSuccess(data);
  return data;
}

async function gameOperation<T>(
  key: string,
  task: (ctx: Context) => Promise<T>
) {
  if (typeof key !== "string" || !key)
    throw new Error("Select a library game first.");
  return tools.queue.enqueue(`manager:${randomUUID()}`, async () => {
    const game = await gamesSublevel.get(key);
    if (!game || game.isDeleted)
      throw new Error("The selected library game no longer exists.");
    const settings = await getLudusaviLocalSettings();
    const lock = await acquireSaveBackupLock(settings.destination);
    try {
      const prepared = await tools.prepareBaseConfig(settings);
      const linkedTitle = settings.games[key]?.manifestTitle;
      let canonical = linkedTitle ?? game.title;
      try {
        // Recovery must work from existing archives even without a local manifest.
        const lookup = JSON.parse(
          await command(
            prepared.binary,
            [
              "--config",
              prepared.configDir,
              "--no-manifest-update",
              "find",
              "--restore",
              "--normalized",
              "--api",
              "--path",
              settings.destination,
              ...(!linkedTitle &&
              game.shop === "steam" &&
              /^\d+$/.test(game.objectId)
                ? ["--steam-id", game.objectId]
                : []),
              "--",
              canonical,
            ],
            lock
          )
        ) as SaveApiResponse;
        canonical = Object.keys(lookup.games ?? {})[0] ?? canonical;
      } catch {
        /* A new destination can legitimately contain no archives yet. */
      }
      return await task({ ...prepared, canonical, settings, game, lock });
    } finally {
      await lock.release();
    }
  });
}

async function restoreData(ctx: Context, version: string) {
  const versions = (
    await json(ctx, [
      "backups",
      "--api",
      "--path",
      ctx.settings.destination,
      "--",
      ctx.canonical,
    ])
  ).games?.[ctx.canonical];
  if (!versions?.backups?.some((item) => item.name === version))
    throw new Error("This backup version is no longer available.");
  const data = await json(ctx, [
    "restore",
    "--api",
    "--force",
    "--preview",
    "--no-cloud-sync",
    "--path",
    ctx.settings.destination,
    "--backup",
    version,
    "--",
    ctx.canonical,
  ]);
  if (!data.games?.[ctx.canonical])
    throw new Error("The selected backup could not be read.");
  return { data, versions };
}

async function approvalContext(ctx: Context, data: SaveApiResponse) {
  const index = await json(ctx, [
    "backups",
    "--api",
    "--path",
    ctx.settings.destination,
    "--",
    ctx.canonical,
  ]);
  const archiveDirectory = index.games?.[ctx.canonical]?.backupPath;
  let mappingHash = "";
  if (archiveDirectory) {
    const directory = await confinedSavePath(
      ctx.settings.destination,
      archiveDirectory
    );
    const mapping = await confinedSavePath(
      directory,
      path.join(directory, "mapping.yaml")
    );
    mappingHash = createHash("sha256")
      .update(await fs.readFile(mapping))
      .digest("hex");
  }
  return {
    settings: ctx.settings,
    executable: ctx.game.executablePath,
    config: await fs.readFile(path.join(ctx.configDir, "config.yaml"), "utf8"),
    data,
    mappingHash,
  };
}

async function logOperation<T extends SaveOperationResult>(
  ctx: Context,
  operation: NonNullable<LudusaviLocalResult["operation"]>,
  task: () => Promise<T>
) {
  const entry: LudusaviLocalResult = {
    gameKey: `${ctx.game.shop}:${ctx.game.objectId}`,
    title: ctx.game.title,
    at: new Date().toISOString(),
    operation,
    status: "failed",
    files: 0,
    bytes: 0,
    registryKeys: 0,
    filePaths: [],
    message: "",
    cloudSync: "not-verified",
  };
  try {
    const result = await task();
    entry.status = "success";
    entry.message = result.message;
    entry.files = result.files ?? 0;
    entry.bytes = result.bytes ?? 0;
    entry.registryKeys = result.registryKeys ?? 0;
    entry.filePaths = result.filePaths ?? [];
    if (operation === "upload" || operation === "download")
      entry.cloudSync = "complete";
    await tools.record(entry);
    return result;
  } catch (error) {
    entry.message =
      error instanceof Error ? error.message : "Save operation failed.";
    await tools.record(entry);
    throw error;
  }
}

async function validate(ctx: Context, version: string) {
  const { versions } = await restoreData(ctx, version);
  if (!versions.backupPath) throw new Error("No backup location was reported.");
  const sevenZip = path.join(
    app.isPackaged ? process.resourcesPath : app.getAppPath(),
    app.isPackaged ? "" : "binaries",
    "7z.exe"
  );
  return validateSaveVersion(
    ctx.settings.destination,
    versions.backupPath,
    version,
    async (file) => {
      await command(sevenZip, ["t", "-bso0", "-bsp0", "-p-", "--", file]);
      const listing = await command(sevenZip, [
        "l",
        "-slt",
        "-ba",
        "-sccUTF-8",
        "--",
        file,
      ]);
      return new Set(
        [...listing.matchAll(/^Path = (.+)\r?$/gm)].map((item) =>
          item[1].trim().replaceAll("\\", "/")
        )
      );
    }
  );
}

export const listSaveBackupVersions = (key: string) =>
  gameOperation(key, async (ctx) => {
    const versions =
      (
        await json(ctx, [
          "backups",
          "--api",
          "--path",
          ctx.settings.destination,
          "--",
          ctx.canonical,
        ])
      ).games?.[ctx.canonical]?.backups ?? [];
    await tools.backfillGameBackupVersionSummary(key, versions);
    return {
      title: ctx.canonical,
      versions,
    };
  });

export const previewSaveRestore = (key: string, version: string) =>
  gameOperation(key, async (ctx) => {
    const { data } = await restoreData(ctx, version);
    return approvals.issue(
      {
        operation: "restore",
        gameKey: key,
        title: ctx.canonical,
        backup: version,
        files: savePreviewFiles(data, ctx.canonical),
        registry: Object.entries(data.games?.[ctx.canonical]?.registry ?? {})
          .filter(([, value]) => !value.ignored)
          .map(([name]) => name),
      },
      await approvalContext(ctx, data)
    );
  });

async function snapshotLiveSaves(ctx: Context, data: SaveApiResponse) {
  const targets = savePreviewFiles(data, ctx.canonical).filter(
    (file) => !file.ignored
  );
  const existingTargets: string[] = [];
  for (const file of targets) {
    try {
      if (!(await fs.stat(file.path)).isFile())
        throw new Error("A restore target is not a regular file.");
      existingTargets.push(file.path);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }
  const id = randomUUID();
  const safetyPath = path.join(
    ctx.settings.destination,
    ".hydra-restore-safety",
    id
  );
  const configDir = path.join(tools.folder(), ".tmp", `restore-${id}`);
  await fs.mkdir(configDir, { recursive: true });
  const config = {
    manifest: { enable: false },
    roots: [],
    cloud: { synchronize: false },
    customGames: [
      {
        name: ctx.canonical,
        integration: "override",
        files: savePreviewFiles(data, ctx.canonical)
          .filter((file) => !file.ignored)
          .map((file) => file.path),
        registry: Object.entries(data.games?.[ctx.canonical]?.registry ?? {})
          .filter(([, value]) => !value.ignored)
          .map(([name]) => name),
      },
    ],
    backup: { path: safetyPath, retention: { full: 1, differential: 0 } },
  };
  try {
    await fs.writeFile(
      path.join(configDir, "config.yaml"),
      YAML.stringify(config)
    );
    const saved = JSON.parse(
      await command(
        ctx.binary,
        [
          "--config",
          configDir,
          "--no-manifest-update",
          "backup",
          "--api",
          "--force",
          "--no-cloud-sync",
          "--format",
          "zip",
          "--path",
          safetyPath,
          "--",
          ctx.canonical,
        ],
        ctx.lock
      )
    ) as SaveApiResponse;
    assertSaveApiSuccess(saved);
    const scanned = saved.games?.[ctx.canonical];
    // Ludusavi omits the game entirely when no current data exists.
    if (
      !scanned &&
      !existingTargets.length &&
      !Object.keys(saved.games ?? {}).length
    )
      return undefined;
    if (!scanned || scanned.decision !== "Processed")
      throw new Error(
        "The pre-restore snapshot could not be verified. Restoration was stopped."
      );
    const captured = new Set(
      Object.entries(scanned.files ?? {})
        .filter(([, item]) => !item.ignored)
        .map(([file]) => path.win32.normalize(file).toLowerCase())
    );
    if (
      existingTargets.some(
        (file) => !captured.has(path.win32.normalize(file).toLowerCase())
      )
    )
      throw new Error(
        "Some current save files were not captured. Restoration was stopped."
      );
    const existingFiles = Object.values(scanned.files ?? {}).some(
      (item) => !item.ignored
    );
    const existingRegistry = Object.values(scanned.registry ?? {}).some(
      (item) => !item.ignored
    );
    return existingFiles || existingRegistry ? safetyPath : undefined;
  } finally {
    // Only this operation's configuration is temporary; snapshots persist.
    await removeSaveScratch(configDir);
  }
}

export const confirmSaveOperation = async (token: string) => {
  const requested = approvals.peek(token);
  return gameOperation(requested.gameKey, (ctx) =>
    logOperation(ctx, requested.operation, async () => {
      if (requested.operation === "restore") {
        await tools.assertStopped(ctx.game, ctx.settings);
        const { data } = await restoreData(ctx, requested.backup);
        approvals.consume(token, await approvalContext(ctx, data));
        await validate(ctx, requested.backup);
        const safetyPath = await snapshotLiveSaves(ctx, data);
        await tools.assertStopped(ctx.game, ctx.settings);
        const completed = await json(ctx, [
          "restore",
          "--api",
          "--force",
          "--no-cloud-sync",
          "--path",
          ctx.settings.destination,
          "--backup",
          requested.backup,
          "--",
          ctx.canonical,
        ]);
        if (completed.games?.[ctx.canonical]?.decision !== "Processed")
          throw new Error(
            "The selected game was not restored. Check the retained pre-restore snapshot before retrying."
          );
        return {
          message: safetyPath
            ? "The selected save version was restored. A pre-restore snapshot was kept separately."
            : "The selected save version was restored. No existing affected save data was found to snapshot.",
          safetyPath,
          files: savePreviewFiles(data, ctx.canonical).filter(
            (file) => !file.ignored
          ).length,
          filePaths: savePreviewFiles(data, ctx.canonical)
            .filter((file) => !file.ignored)
            .map((file) => file.path),
          bytes: savePreviewFiles(data, ctx.canonical)
            .filter((file) => !file.ignored)
            .reduce((sum, file) => sum + file.bytes, 0),
          registryKeys: Object.values(
            data.games?.[ctx.canonical]?.registry ?? {}
          ).filter((item) => !item.ignored).length,
        };
      }
      const data = await cloudData(ctx, requested.operation, true);
      approvals.consume(token, await approvalContext(ctx, data));
      const completed = await cloudData(ctx, requested.operation, false);
      const paths = Object.keys(completed.cloud ?? completed.changes ?? {});
      return {
        files: paths.length,
        filePaths: paths,
        message:
          requested.operation === "upload"
            ? "The remote upload command completed successfully."
            : "Remote backups were downloaded. Live game saves were not restored.",
      };
    })
  );
};

export const validateSaveBackup = (key: string, version: string) =>
  gameOperation(key, (ctx) =>
    logOperation(ctx, "validate", async () => {
      const result = await validate(ctx, version);
      return {
        message: `Validation passed: ${result.files} mapped files checked; ${result.archives} ZIP archives passed integrity checks. Live saves were unchanged.`,
        files: result.files,
      };
    })
  );

async function cloudData(
  ctx: Context,
  direction: "upload" | "download",
  preview: boolean
) {
  const config = parseSaveEngineConfig(
    await fs.readFile(path.join(ctx.configDir, "config.yaml"), "utf8")
  );
  if (!config.cloud?.remote)
    throw new Error(
      `${REMOTE_SETUP_REQUIRED} Open Set up remote storage, select Other in the manager, and configure Rclone and cloud storage before previewing a transfer.`
    );
  return json(ctx, [
    "cloud",
    direction,
    "--api",
    "--force",
    "--local",
    ctx.settings.destination,
    ...(preview ? ["--preview"] : []),
    "--",
    ctx.canonical,
  ]);
}

export const previewSaveCloudTransfer = (
  key: string,
  direction: "upload" | "download"
) => {
  if (!["upload", "download"].includes(direction))
    throw new Error("Invalid remote operation.");
  return gameOperation(key, async (ctx) => {
    const data = await cloudData(ctx, direction, true);
    return approvals.issue(
      {
        operation: direction,
        gameKey: key,
        title: ctx.canonical,
        backup: "",
        files: Object.entries(data.cloud ?? data.changes ?? {}).map(
          ([file, item]) => ({
            path: file,
            bytes: 0,
            change: item.change ?? "Unknown",
            ignored: false,
            failed: false,
          })
        ),
        registry: [],
      },
      await approvalContext(ctx, data)
    );
  });
};

export const getSaveAdvancedConfig = () =>
  tools.queue.enqueue(`config:${randomUUID()}`, async () => {
    const prepared = await tools.prepareBaseConfig(
      await getLudusaviLocalSettings()
    );
    return YAML.stringify(prepared.config);
  });

async function persistAdvancedConfig(
  text: string,
  settings: LudusaviLocalSettings
) {
  const config = managedSaveConfig(parseSaveEngineConfig(text), settings);
  const scratch = path.join(tools.folder(), ".tmp", `config-${randomUUID()}`);
  await fs.mkdir(scratch, { recursive: true });
  try {
    await fs.writeFile(
      path.join(scratch, "config.yaml"),
      YAML.stringify(config)
    );
    // The bundled executable is the authority for its configuration schema.
    await command(tools.binaryPath(), [
      "--config",
      scratch,
      "--no-manifest-update",
      "config",
      "show",
    ]);
    const file = path.join(tools.folder(), "advanced.yaml");
    await fs
      .copyFile(file, `${file}.old`)
      .catch((error: NodeJS.ErrnoException) => {
        if (error.code !== "ENOENT") throw error;
      });
    const pending = `${file}.pending`;
    await fs.writeFile(pending, YAML.stringify(config));
    await fs.rename(pending, file);
  } finally {
    await removeSaveScratch(scratch);
  }
}

export const saveSaveAdvancedConfig = (text: string) =>
  tools.queue.enqueue(`config:${randomUUID()}`, async () => {
    if (typeof text !== "string")
      throw new Error("Configuration must be YAML text.");
    await persistAdvancedConfig(text, await getLudusaviLocalSettings());
  });

export const importStandaloneSaveConfig = () =>
  tools.queue.enqueue(`config:${randomUUID()}`, async () => {
    const file = path.join(
      SystemPath.getPath("appData"),
      "ludusavi",
      "config.yaml"
    );
    await persistAdvancedConfig(
      await fs.readFile(file, "utf8"),
      await getLudusaviLocalSettings()
    );
  });

export const updateSaveManifest = () =>
  tools.queue.enqueue(`manifest:${randomUUID()}`, async () => {
    const { binary, configDir } = await tools.prepareBaseConfig(
      await getLudusaviLocalSettings()
    );
    await command(binary, [
      "--config",
      configDir,
      "manifest",
      "update",
      "--force",
    ]);
  });

/** The native manager exposes the complete GUI without a second configuration. */
export const openFullSaveManager = (key?: string) =>
  tools.queue.enqueue(`gui:${randomUUID()}`, async () => {
    if (getTrackedGamesRunning(performance.now()).length)
      throw new Error(
        "Stop tracked games before opening the full save manager."
      );
    const settings = await getLudusaviLocalSettings();
    for (const game of await gamesSublevel.values().all())
      if (!game.isDeleted && game.executablePath)
        await tools.assertStopped(game, settings);
    const lock = await acquireSaveBackupLock(settings.destination);
    try {
      const game = key ? await gamesSublevel.get(key) : undefined;
      if (key && (!game || game.isDeleted))
        throw new Error("The selected library game no longer exists.");
      const { binary, configDir } = game
        ? await tools.prepareConfig(game, settings, false)
        : await tools.prepareBaseConfig(settings);
      await new Promise<void>((resolve, reject) => {
        const child = spawn(
          binary,
          ["--config", configDir, "--no-manifest-update"],
          { windowsHide: true, stdio: "ignore" }
        );
        child.once("error", reject);
        child.once("spawn", () => {
          void lock.child(child.pid).catch(() => {
            child.kill();
            reject(new Error("Cannot register the manager process."));
          });
        });
        child.once("exit", (code) =>
          code === 0
            ? resolve()
            : reject(new Error("The full save manager exited unexpectedly."))
        );
      });
      const edited = parseSaveEngineConfig(
        await fs.readFile(path.join(configDir, "config.yaml"), "utf8")
      );
      const retention = edited.backup?.retention as
        | { full?: number; differential?: number }
        | undefined;
      const format = edited.backup?.format as
        | {
            chosen?: LudusaviLocalSettings["format"];
            zip?: { compression?: LudusaviLocalSettings["compression"] };
          }
        | undefined;
      const next = {
        ...settings,
        ...(typeof edited.backup?.path === "string" &&
        path.isAbsolute(edited.backup.path)
          ? { destination: edited.backup.path }
          : {}),
        fullRetention: retention?.full ?? settings.fullRetention,
        differentialRetention: retention?.differential ?? 0,
        format: format?.chosen ?? settings.format,
        compression: format?.zip?.compression ?? settings.compression,
      };
      await persistAdvancedConfig(YAML.stringify(edited), next);
      await db.put("ludusaviLocalSettings", next, { valueEncoding: "json" });
    } finally {
      await lock.release();
    }
  });

export { command as runSaveToolCommand };
