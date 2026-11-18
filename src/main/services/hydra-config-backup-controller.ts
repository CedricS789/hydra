import fs from "node:fs/promises";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import YAML from "yaml";
import type {
  LudusaviLocalSettings,
  SaveBackupVersion,
  SaveOperationPreview,
  SaveSafetySnapshot,
  UserPreferences,
} from "@types";
import {
  HYDRA_CONFIG_BACKUP_ENTRY,
  HYDRA_CONFIG_EXCLUDED_ITEMS,
  HYDRA_CONFIG_RESTORE_CONFIRMATION,
  type HydraConfigBackupRecord,
  type HydraConfigBackupResult,
  type HydraConfigBackupState,
  type HydraConfigRestorePreview,
  type HydraConfigRestoreRequest,
  type HydraConfigRestoreResult,
} from "../../shared/hydra-config-backup.js";
import { DIRECT_TORRENT_CONFIRMATION } from "../../shared/direct-torrent-policy.js";
import {
  managedSaveConfig,
  type SaveEngineConfig,
} from "./ludusavi-local-config.js";
import {
  assertSaveApiSuccess,
  SaveOperationApprovals,
  type SaveApiResponse,
} from "./ludusavi-local-api.js";
import { confinedSafetySnapshotPath } from "./ludusavi-local-validation.js";
import {
  applyHydraConfigSnapshot,
  diffHydraConfigSnapshot,
  readAndValidateHydraConfigSnapshot,
  readLiveHydraConfig,
  writeHydraConfigSnapshotToDir,
  type HydraConfigStoreAdapter,
  type ValidatedHydraConfigSnapshot,
} from "./hydra-config-snapshot.js";

export interface ConfigEngineLock {
  child: (childPid?: number) => Promise<void>;
  release: () => Promise<void>;
}

export interface ConfigEngineContext {
  binary: string;
  configDir: string;
  canonical: string;
  settings: LudusaviLocalSettings;
  lock: ConfigEngineLock;
}

export interface ConfigEngineOperations {
  runJson: (
    ctx: ConfigEngineContext,
    args: string[]
  ) => Promise<SaveApiResponse>;
  backupsForCanonical: (
    ctx: ConfigEngineContext,
    rootPath?: string
  ) => Promise<
    { backups?: SaveBackupVersion[]; backupPath?: string } | undefined
  >;
  restoreDataForCanonical: (
    ctx: ConfigEngineContext,
    version: string,
    rootPath?: string
  ) => Promise<{ data: SaveApiResponse; versions: { backupPath?: string } }>;
  validateArchive: (
    ctx: ConfigEngineContext,
    version: string,
    rootPath?: string
  ) => Promise<{ files: number; archives: number }>;
  listSafetySnapshots: (
    ctx: ConfigEngineContext
  ) => Promise<SaveSafetySnapshot[]>;
  cloudDataForCanonical: (
    ctx: ConfigEngineContext,
    direction: "upload" | "download",
    preview: boolean
  ) => Promise<SaveApiResponse>;
}

export interface PendingConfigRestore {
  owner: number;
  preview: HydraConfigRestorePreview;
  fingerprint: string;
  snapshotDigest: string;
  backup: string;
  snapshotId?: string;
}

export interface ConfigBackupRuntimeDeps {
  adapter: HydraConfigStoreAdapter;
  engine: ConfigEngineOperations;
  snapshotDir: () => string;
  scratchRoot: () => string;
  binaryPath: () => string;
  readBaseSaveConfig: (
    settings: LudusaviLocalSettings
  ) => Promise<SaveEngineConfig>;
  getSettings: () => Promise<LudusaviLocalSettings>;
  acquireLock: (destination: string) => Promise<ConfigEngineLock>;
  enqueue: <T>(key: string, task: () => Promise<T>) => Promise<T>;
  withPreferencesLock: <T>(task: () => Promise<T>) => Promise<T>;
  assertSafeForRestore: (
    settings: LudusaviLocalSettings,
    adapter: HydraConfigStoreAdapter
  ) => Promise<void>;
  applySideEffects: (args: {
    previousLanguage: string | null;
    newLanguage: string | null;
    previousPreferences: UserPreferences | null;
    newPreferences: UserPreferences | null;
    appliedSections: HydraConfigRestoreResult["appliedSections"];
  }) => Promise<void>;
  getRecord: () => Promise<HydraConfigBackupRecord>;
  saveRecord: (record: HydraConfigBackupRecord) => Promise<void>;
  now?: () => number;
}

const sha256Json = (value: unknown) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");

export class HydraConfigBackupController {
  private pendingRestores = new Map<string, PendingConfigRestore>();
  private cloudApprovals = new SaveOperationApprovals();
  private now: () => number;

  constructor(private deps: ConfigBackupRuntimeDeps) {
    this.now = deps.now ?? (() => Date.now());
  }

  private async withConfigEngine<T>(
    settings: LudusaviLocalSettings,
    lock: ConfigEngineLock,
    options: {
      sourceDir?: string;
      redirects?: { kind: "restore"; source: string; target: string }[];
      retentionOverride?: { full: number; differential: number };
      destinationOverride?: string;
    },
    task: (ctx: ConfigEngineContext) => Promise<T>
  ): Promise<T> {
    const scratchParent = this.deps.scratchRoot();
    await fs.mkdir(scratchParent, { recursive: true });
    const configDir = path.join(scratchParent, `cfg-engine-${randomUUID()}`);
    await fs.mkdir(configDir, { recursive: true });
    try {
      const base = await this.deps.readBaseSaveConfig(settings);
      const effectiveSettings = options.destinationOverride
        ? { ...settings, destination: options.destinationOverride }
        : settings;
      const managed = managedSaveConfig(base, effectiveSettings);
      const config: SaveEngineConfig = {
        ...managed,
        manifest: { enable: false },
        roots: [],
        customGames: [
          {
            name: HYDRA_CONFIG_BACKUP_ENTRY,
            integration: "override",
            files: [options.sourceDir ?? this.deps.snapshotDir()],
            registry: [],
          },
        ],
        ...(options.redirects ? { redirects: options.redirects } : {}),
      };
      if (options.retentionOverride && config.backup) {
        config.backup = {
          ...config.backup,
          retention: options.retentionOverride,
        };
      }
      await fs.writeFile(
        path.join(configDir, "config.yaml"),
        YAML.stringify(config)
      );
      return await task({
        binary: this.deps.binaryPath(),
        configDir,
        canonical: HYDRA_CONFIG_BACKUP_ENTRY,
        settings,
        lock,
      });
    } finally {
      await fs
        .rm(configDir, { recursive: true, force: true })
        .catch(() => undefined);
    }
  }

  private async resolveRoot(
    settings: LudusaviLocalSettings,
    snapshotId?: string
  ) {
    if (!snapshotId) return settings.destination;
    return confinedSafetySnapshotPath(settings.destination, snapshotId);
  }

  private async extractVersionToStaging(
    ctx: ConfigEngineContext,
    settings: LudusaviLocalSettings,
    lock: ConfigEngineLock,
    version: string,
    rootPath: string
  ): Promise<{
    stagingDir: string;
    validated: ValidatedHydraConfigSnapshot;
    manifestDigest: string;
  }> {
    await this.deps.engine.validateArchive(ctx, version, rootPath);
    const { data } = await this.deps.engine.restoreDataForCanonical(
      ctx,
      version,
      rootPath
    );
    const files = Object.keys(
      data.games?.[HYDRA_CONFIG_BACKUP_ENTRY]?.files ?? {}
    );
    const manifestKey = files.find((filePath) => {
      const normalized = filePath.replaceAll("\\", "/");
      return (
        normalized === "manifest.json" ||
        normalized.toLowerCase().endsWith("/manifest.json")
      );
    });
    if (!manifestKey) {
      throw new Error(
        "The selected backup does not contain a Hydra configuration manifest."
      );
    }
    const sourceRoot = manifestKey.slice(
      0,
      manifestKey.length - "/manifest.json".length
    );
    if (!sourceRoot) {
      throw new Error("The archived configuration path cannot be resolved.");
    }

    const scratchParent = this.deps.scratchRoot();
    await fs.mkdir(scratchParent, { recursive: true });
    const stagingDir = path.join(scratchParent, `cfg-restore-${randomUUID()}`);
    await fs.mkdir(stagingDir, { recursive: true });

    try {
      const restored = await this.withConfigEngine(
        settings,
        lock,
        {
          redirects: [
            {
              kind: "restore",
              source: sourceRoot,
              target: stagingDir,
            },
          ],
        },
        (restoreCtx) =>
          this.deps.engine.runJson(restoreCtx, [
            "restore",
            "--api",
            "--force",
            "--no-cloud-sync",
            "--path",
            rootPath,
            "--backup",
            version,
            "--",
            HYDRA_CONFIG_BACKUP_ENTRY,
          ])
      );
      if (
        restored.games?.[HYDRA_CONFIG_BACKUP_ENTRY]?.decision !== "Processed"
      ) {
        throw new Error("Ludusavi did not extract the configuration archive.");
      }
      const validated = await readAndValidateHydraConfigSnapshot(stagingDir);
      const manifestRaw = await fs.readFile(
        path.join(validated.rootDir, "manifest.json"),
        "utf8"
      );
      const manifestDigest = createHash("sha256")
        .update(manifestRaw)
        .digest("hex");
      return { stagingDir, validated, manifestDigest };
    } catch (error) {
      await fs
        .rm(stagingDir, { recursive: true, force: true })
        .catch(() => undefined);
      throw error;
    }
  }

  private async liveFingerprint(
    settings: LudusaviLocalSettings,
    backup: string,
    snapshotId: string | undefined,
    manifestDigest: string
  ) {
    const live = await readLiveHydraConfig(this.deps.adapter);
    return sha256Json({
      live,
      destination: settings.destination,
      backup,
      snapshotId: snapshotId ?? "",
      manifestDigest,
    });
  }

  async getState(): Promise<HydraConfigBackupState> {
    return this.deps.enqueue(`cfg-state:${randomUUID()}`, async () => {
      const settings = await this.deps.getSettings();
      const lastBackup = await this.deps.getRecord();
      let versions: HydraConfigBackupState["versions"] = [];
      let safetySnapshots: HydraConfigBackupState["safetySnapshots"] = [];
      try {
        const lock = await this.deps.acquireLock(settings.destination);
        try {
          const listed = await this.withConfigEngine(
            settings,
            lock,
            {},
            async (ctx) => {
              const [backups, safety] = await Promise.all([
                this.deps.engine
                  .backupsForCanonical(ctx)
                  .then((entry) => entry?.backups ?? []),
                this.deps.engine.listSafetySnapshots(ctx),
              ]);
              return { backups, safety };
            }
          );
          versions = listed.backups;
          safetySnapshots = listed.safety;
        } finally {
          await lock.release();
        }
      } catch {
        /* Destination may be empty or temporarily unreachable while reading state. */
      }

      return {
        entryName: HYDRA_CONFIG_BACKUP_ENTRY,
        snapshotDir: this.deps.snapshotDir(),
        destination: settings.destination,
        lastBackup,
        versions,
        safetySnapshots,
        excludedItems: HYDRA_CONFIG_EXCLUDED_ITEMS,
      };
    });
  }

  async backupNow(preview = false): Promise<HydraConfigBackupResult> {
    return this.deps.enqueue(`cfg-backup:${preview}`, async () => {
      const settings = await this.deps.getSettings();
      const lock = await this.deps.acquireLock(settings.destination);
      const at = new Date(this.now()).toISOString();
      try {
        const snapshotDir = this.deps.snapshotDir();
        await writeHydraConfigSnapshotToDir(this.deps.adapter, snapshotDir);
        const data = await this.withConfigEngine(
          settings,
          lock,
          { sourceDir: snapshotDir },
          (ctx) =>
            this.deps.engine.runJson(ctx, [
              "backup",
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
              ...(preview ? ["--preview"] : []),
              "--",
              HYDRA_CONFIG_BACKUP_ENTRY,
            ])
        );
        const entry = data.games?.[HYDRA_CONFIG_BACKUP_ENTRY];
        if (!entry || entry.decision !== "Processed") {
          throw new Error("Hydra configuration backup was not processed.");
        }
        const files = Object.values(entry.files ?? {}).filter(
          (item) => !item.ignored
        ).length;
        const bytes = data.overall?.processedBytes ?? 0;
        const message = preview
          ? `Configuration preview completed (${files} files, ${bytes} bytes).`
          : `Hydra configuration backed up (${files} files, ${bytes} bytes).`;
        if (!preview) {
          await this.deps.saveRecord({
            lastBackupAt: at,
            lastBackupStatus: "success",
            lastBackupMessage: message,
          });
        }
        return {
          status: preview ? "preview" : "success",
          at,
          files,
          bytes,
          message,
          snapshotDir,
        };
      } catch (error) {
        if (!preview) {
          await this.deps.saveRecord({
            lastBackupAt: at,
            lastBackupStatus: "failed",
            lastBackupMessage:
              error instanceof Error ? error.message : String(error),
          });
        }
        throw error;
      } finally {
        await lock.release();
      }
    });
  }

  async validateBackup(version: string, snapshotId?: string) {
    return this.deps.enqueue(`cfg-validate:${randomUUID()}`, async () => {
      const settings = await this.deps.getSettings();
      const rootPath = await this.resolveRoot(settings, snapshotId);
      const lock = await this.deps.acquireLock(settings.destination);
      try {
        const result = await this.withConfigEngine(settings, lock, {}, (ctx) =>
          this.deps.engine.validateArchive(ctx, version, rootPath)
        );
        return {
          message: `Validation passed: ${result.files} configuration files checked; ${result.archives} ZIP archives passed integrity checks.`,
          files: result.files,
        };
      } finally {
        await lock.release();
      }
    });
  }

  async previewRestore(
    owner: number,
    version: string,
    snapshotId?: string
  ): Promise<HydraConfigRestorePreview> {
    if (!version || typeof version !== "string") {
      throw new Error("Select a configuration backup version first.");
    }
    return this.deps.enqueue(`cfg-preview:${randomUUID()}`, async () => {
      for (const [token, pending] of this.pendingRestores) {
        if (
          pending.preview.expiresAt <= this.now() ||
          pending.owner === owner
        ) {
          this.pendingRestores.delete(token);
        }
      }
      if (this.pendingRestores.size >= 20) {
        this.pendingRestores.delete(this.pendingRestores.keys().next().value!);
      }

      const settings = await this.deps.getSettings();
      await this.deps.assertSafeForRestore(settings, this.deps.adapter);
      const rootPath = await this.resolveRoot(settings, snapshotId);
      const lock = await this.deps.acquireLock(settings.destination);
      let stagingDir: string | undefined;
      try {
        const extracted = await this.withConfigEngine(
          settings,
          lock,
          {},
          (ctx) =>
            this.extractVersionToStaging(ctx, settings, lock, version, rootPath)
        );
        stagingDir = extracted.stagingDir;
        const diff = await diffHydraConfigSnapshot(
          this.deps.adapter,
          extracted.validated
        );
        const fingerprint = await this.liveFingerprint(
          settings,
          version,
          snapshotId,
          extracted.manifestDigest
        );
        const token = randomUUID();
        const preview: HydraConfigRestorePreview = {
          token,
          operation: "restore",
          backup: version,
          ...(snapshotId ? { snapshotId } : {}),
          expiresAt: this.now() + 5 * 60_000,
          schemaVersion: extracted.validated.manifest.schemaVersion,
          exportedAt: extracted.validated.manifest.exportedAt,
          sourceHostname: extracted.validated.manifest.hostname,
          sourcePlatform: extracted.validated.manifest.platform,
          sourceAppVersion: extracted.validated.manifest.appVersion,
          destinationDiffers: diff.destinationDiffers,
          currentDestination: diff.currentDestination,
          snapshotDestination: diff.snapshotDestination,
          directTorrentConfirmation: diff.directTorrentConfirmation,
          confirmationPhrase: HYDRA_CONFIG_RESTORE_CONFIRMATION,
          sections: diff.sections,
          pathWarnings: diff.pathWarnings,
        };
        this.pendingRestores.set(token, {
          owner,
          preview,
          fingerprint,
          snapshotDigest: extracted.manifestDigest,
          backup: version,
          snapshotId,
        });
        return preview;
      } finally {
        if (stagingDir) {
          await fs
            .rm(stagingDir, { recursive: true, force: true })
            .catch(() => undefined);
        }
        await lock.release();
      }
    });
  }

  private async createSafetySnapshot(
    settings: LudusaviLocalSettings,
    lock: ConfigEngineLock
  ) {
    const id = randomUUID();
    const safetyPath = path.join(
      settings.destination,
      ".hydra-restore-safety",
      id
    );
    const scratchParent = this.deps.scratchRoot();
    await fs.mkdir(scratchParent, { recursive: true });
    const tempSnapshotSource = path.join(scratchParent, `cfg-safety-src-${id}`);
    try {
      await writeHydraConfigSnapshotToDir(
        this.deps.adapter,
        tempSnapshotSource
      );
      const saved: SaveApiResponse = await this.withConfigEngine(
        settings,
        lock,
        {
          sourceDir: tempSnapshotSource,
          destinationOverride: safetyPath,
          retentionOverride: { full: 1, differential: 0 },
        },
        (ctx) =>
          this.deps.engine.runJson(ctx, [
            "backup",
            "--api",
            "--force",
            "--no-cloud-sync",
            "--format",
            "zip",
            "--path",
            safetyPath,
            "--",
            HYDRA_CONFIG_BACKUP_ENTRY,
          ])
      );
      assertSaveApiSuccess(saved);
      const scanned = saved.games?.[HYDRA_CONFIG_BACKUP_ENTRY];
      if (!scanned || scanned.decision !== "Processed") {
        throw new Error(
          "The pre-restore configuration safety snapshot could not be verified. Restoration was stopped."
        );
      }
      const backupName = await this.withConfigEngine(
        settings,
        lock,
        {},
        async (ctx) =>
          (await this.deps.engine.backupsForCanonical(ctx, safetyPath))
            ?.backups?.[0]?.name
      );
      return {
        safetyPath,
        safetySnapshotId: id,
        safetyBackupName: backupName,
      };
    } finally {
      await fs
        .rm(tempSnapshotSource, { recursive: true, force: true })
        .catch(() => undefined);
    }
  }

  async confirmRestore(
    owner: number,
    request: HydraConfigRestoreRequest
  ): Promise<HydraConfigRestoreResult> {
    const pending = this.pendingRestores.get(request.token);
    this.pendingRestores.delete(request.token);
    if (
      !pending ||
      pending.owner !== owner ||
      pending.preview.expiresAt <= this.now()
    ) {
      throw new Error(
        "This configuration review expired. Preview the backup again before restoring."
      );
    }
    if (
      !request.acknowledged ||
      request.phrase !== HYDRA_CONFIG_RESTORE_CONFIRMATION
    ) {
      throw new Error(
        `Complete the acknowledgement and type ${HYDRA_CONFIG_RESTORE_CONFIRMATION} to continue.`
      );
    }
    const wantsPreferences = request.selection.sections.includes("preferences");
    if (
      pending.preview.directTorrentConfirmation &&
      wantsPreferences &&
      request.torrentConfirmation !== DIRECT_TORRENT_CONFIRMATION
    ) {
      throw new Error(
        `Confirm direct peer-to-peer torrent access by typing ${DIRECT_TORRENT_CONFIRMATION}.`
      );
    }

    return this.deps.enqueue(`cfg-restore:${randomUUID()}`, () =>
      this.deps.withPreferencesLock(async () => {
        const settings = await this.deps.getSettings();
        await this.deps.assertSafeForRestore(settings, this.deps.adapter);
        const rootPath = await this.resolveRoot(settings, pending.snapshotId);
        const lock = await this.deps.acquireLock(settings.destination);
        let stagingDir: string | undefined;
        try {
          const extracted = await this.withConfigEngine(
            settings,
            lock,
            {},
            (ctx) =>
              this.extractVersionToStaging(
                ctx,
                settings,
                lock,
                pending.backup,
                rootPath
              )
          );
          stagingDir = extracted.stagingDir;
          const currentFingerprint = await this.liveFingerprint(
            settings,
            pending.backup,
            pending.snapshotId,
            extracted.manifestDigest
          );
          if (currentFingerprint !== pending.fingerprint) {
            throw new Error(
              "Live settings or the backup archive changed since this review. Preview the restore again."
            );
          }

          const safety = await this.createSafetySnapshot(settings, lock);
          const applied = await applyHydraConfigSnapshot(
            this.deps.adapter,
            extracted.validated,
            request.selection,
            request.torrentConfirmation
          );
          await this.deps.applySideEffects({
            previousLanguage: applied.previousLanguage,
            newLanguage: applied.newLanguage,
            previousPreferences: applied.previousPreferences,
            newPreferences: applied.newPreferences,
            appliedSections: applied.appliedSections,
          });

          return {
            message: `Restored ${applied.appliedSections.length} Hydra configuration section(s). A pre-restore safety snapshot was saved separately.`,
            appliedSections: applied.appliedSections,
            safetySnapshotId: safety.safetySnapshotId,
            safetyBackupName: safety.safetyBackupName,
            safetyPath: safety.safetyPath,
            destinationPreserved: applied.destinationPreserved,
          };
        } finally {
          if (stagingDir) {
            await fs
              .rm(stagingDir, { recursive: true, force: true })
              .catch(() => undefined);
          }
          await lock.release();
        }
      })
    );
  }

  async previewCloudTransfer(
    direction: "upload" | "download"
  ): Promise<SaveOperationPreview> {
    if (!["upload", "download"].includes(direction)) {
      throw new Error("Invalid remote operation.");
    }
    return this.deps.enqueue(`cfg-cloud-preview:${direction}`, async () => {
      const settings = await this.deps.getSettings();
      const lock = await this.deps.acquireLock(settings.destination);
      try {
        const { data, configText } = await this.withConfigEngine(
          settings,
          lock,
          {},
          async (ctx) => ({
            data: await this.deps.engine.cloudDataForCanonical(
              ctx,
              direction,
              true
            ),
            configText: await fs.readFile(
              path.join(ctx.configDir, "config.yaml"),
              "utf8"
            ),
          })
        );
        return this.cloudApprovals.issue(
          {
            operation: direction,
            gameKey: HYDRA_CONFIG_BACKUP_ENTRY,
            title: HYDRA_CONFIG_BACKUP_ENTRY,
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
          { settings, configText, data },
          this.now()
        );
      } finally {
        await lock.release();
      }
    });
  }

  async confirmCloudTransfer(token: string) {
    const requested = this.cloudApprovals.peek(token, this.now());
    if (
      requested.operation !== "upload" &&
      requested.operation !== "download"
    ) {
      throw new Error("Invalid remote operation.");
    }
    return this.deps.enqueue(
      `cfg-cloud-confirm:${requested.operation}`,
      async () => {
        const settings = await this.deps.getSettings();
        const lock = await this.deps.acquireLock(settings.destination);
        try {
          const direction = requested.operation as "upload" | "download";
          const previewCheck = await this.withConfigEngine(
            settings,
            lock,
            {},
            async (ctx) => ({
              data: await this.deps.engine.cloudDataForCanonical(
                ctx,
                direction,
                true
              ),
              configText: await fs.readFile(
                path.join(ctx.configDir, "config.yaml"),
                "utf8"
              ),
            })
          );
          this.cloudApprovals.consume(
            token,
            {
              settings,
              configText: previewCheck.configText,
              data: previewCheck.data,
            },
            this.now()
          );
          const completed = await this.withConfigEngine(
            settings,
            lock,
            {},
            (ctx) =>
              this.deps.engine.cloudDataForCanonical(ctx, direction, false)
          );
          const paths = Object.keys(completed.cloud ?? completed.changes ?? {});
          return {
            files: paths.length,
            filePaths: paths,
            message:
              direction === "upload"
                ? "Hydra configuration remote upload completed."
                : "Hydra configuration remote backups were downloaded. Live Hydra settings were not modified.",
          };
        } finally {
          await lock.release();
        }
      }
    );
  }
}
