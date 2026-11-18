import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import i18next from "i18next";
import { app } from "electron";
import type {
  DownloadSource,
  EmulatorConfig,
  EmulatorSystem,
  ExcludedLibraryGame,
  Game,
  LudusaviLocalSettings,
  RetroArchConfig,
  Theme,
  UserPreferences,
} from "@types";
import type { SourceWebsiteProfile } from "../../types/source-browser.types";
import type {
  HydraConfigBackupRecord,
  HydraConfigRestoreRequest,
  HydraConfigRestoreResult,
} from "../../shared/hydra-config-backup.js";
import { allowsDirectTorrent } from "../../shared/direct-torrent-policy.js";
import {
  db,
  cloudSaveAutomaticSyncSettingsSublevel,
  cloudSaveCustomPathsSublevel,
  cloudSaveEmulatorDestinationsSublevel,
  downloadSourcesSublevel,
  emulatorsSublevel,
  excludedLibraryGamesSublevel,
  gamesSublevel,
  levelKeys,
  retroarchSublevel,
  themesSublevel,
} from "../level";
import { SystemPath } from "./system-path";
import { getThemePath, getThemeSoundPath } from "../helpers";
import {
  getLudusaviLocalSettings,
  localSaveTools as tools,
  persistLudusaviLocalSettings,
} from "./ludusavi-local";
import {
  backupsForCanonical,
  cloudDataForCanonical,
  listSafetySnapshotsForCanonical,
  persistAdvancedConfig,
  restoreDataForCanonical,
  runSaveToolJson,
  validateCanonicalBackupVersion,
  type SaveEngineContext,
} from "./ludusavi-local-manager";
import { acquireSaveBackupLock } from "./ludusavi-local-lock";
import { hasTrackedGamesRunning } from "./game-running-state";
import { NativeAddon } from "./native-addon";
import { DownloadManager } from "./download/download-manager";
import { WindowManager } from "./window-manager";
import { Wine } from "./wine";
import { ScreenshotInputService } from "./screenshot-input";
import { GamepadWakeService } from "./gamepad-wake";
import { BigPictureGameWindowService } from "./big-picture-game-window";
import { achievementNotificationPresenter } from "./achievement-notification-presenter-electron";
import { setDirectTorrentAccess } from "./torrent-service";
import { applyAutoLaunch } from "../events/user-preferences/auto-launch";
import { withUserPreferencesLock } from "../events/user-preferences/update-user-preferences";
import type { HydraConfigStoreAdapter } from "./hydra-config-snapshot";
import {
  HydraConfigBackupController,
  type ConfigEngineContext,
} from "./hydra-config-backup-controller";

const CONFIG_BACKUP_RECORD_KEY = "hydraConfigBackupRecord";
const SOURCE_PROFILES_KEY = "sourceWebsiteProfiles";

const snapshotDirectory = () =>
  path.join(SystemPath.getPath("userData"), "hydra-config-snapshot");

function defaultRecord(): HydraConfigBackupRecord {
  return {
    lastBackupAt: null,
    lastBackupStatus: null,
    lastBackupMessage: null,
  };
}

async function replaceSublevel<V>(
  sublevel: {
    clear(): Promise<void>;
    batch(ops: { type: "put"; key: string; value: V }[]): Promise<void>;
  },
  entries: [string, V][]
) {
  await sublevel.clear();
  if (entries.length) {
    await sublevel.batch(
      entries.map(([key, value]) => ({ type: "put", key, value }))
    );
  }
}

export function createLiveConfigStoreAdapter(): HydraConfigStoreAdapter {
  const advancedFile = () => path.join(tools.folder(), "advanced.yaml");

  return {
    appVersion: app.getVersion(),
    hostname: os.hostname(),
    platform: process.platform,
    getUserPreferences: () =>
      db
        .get<string, UserPreferences | null>(levelKeys.userPreferences, {
          valueEncoding: "json",
        })
        .catch(() => null),
    putUserPreferences: (value) =>
      db.put(levelKeys.userPreferences, value, { valueEncoding: "json" }),
    getLanguage: () =>
      db
        .get<string, string | null>(levelKeys.language, {
          valueEncoding: "utf8",
        })
        .catch(() => null),
    putLanguage: (language) =>
      db.put(levelKeys.language, language, { valueEncoding: "utf8" }),
    getLudusaviSettings: () => getLudusaviLocalSettings(),
    putLudusaviSettings: (value) => persistLudusaviLocalSettings(value),
    readAdvancedYaml: async () => {
      try {
        return await fs.readFile(advancedFile(), "utf8");
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
        throw error;
      }
    },
    writeAdvancedYaml: async (yamlText) => {
      const target = advancedFile();
      if (yamlText === null) {
        await fs
          .copyFile(target, `${target}.old`)
          .catch((error: NodeJS.ErrnoException) => {
            if (error.code !== "ENOENT") throw error;
          });
        await fs.rm(target, { force: true });
        return;
      }
      await persistAdvancedConfig(yamlText, await getLudusaviLocalSettings());
    },
    getDownloadSources: () => downloadSourcesSublevel.values().all(),
    replaceDownloadSources: (items: DownloadSource[]) =>
      replaceSublevel(
        downloadSourcesSublevel,
        items.map((item) => [item.id, item])
      ),
    getEmulators: () => emulatorsSublevel.iterator().all(),
    replaceEmulators: (entries: [EmulatorSystem, EmulatorConfig][]) =>
      replaceSublevel(
        emulatorsSublevel as unknown as {
          clear(): Promise<void>;
          batch(
            ops: { type: "put"; key: string; value: EmulatorConfig }[]
          ): Promise<void>;
        },
        entries
      ),
    getRetroArch: () => retroarchSublevel.iterator().all(),
    replaceRetroArch: (entries: [string, RetroArchConfig][]) =>
      replaceSublevel(retroarchSublevel, entries),
    getEmulatorDestinations: () =>
      cloudSaveEmulatorDestinationsSublevel.iterator().all(),
    replaceEmulatorDestinations: (entries: [string, unknown][]) =>
      replaceSublevel(cloudSaveEmulatorDestinationsSublevel, entries),
    getThemes: () => themesSublevel.values().all(),
    replaceThemes: (themes: Theme[]) =>
      replaceSublevel(
        themesSublevel,
        themes.map((theme) => [theme.id, theme])
      ),
    resolveThemeSoundPath: (theme) => getThemeSoundPath(theme.id, theme.name),
    installThemeSoundAsset: async (theme, sourceFile) => {
      const themeDir = getThemePath(theme.id, theme.name);
      await fs.mkdir(themeDir, { recursive: true });
      const ext = path.extname(sourceFile).toLowerCase();
      await fs.copyFile(sourceFile, path.join(themeDir, `achievement${ext}`));
    },
    getSourceProfiles: async () =>
      (await db
        .get<
          string,
          Record<string, SourceWebsiteProfile> | null
        >(SOURCE_PROFILES_KEY, { valueEncoding: "json" })
        .catch(() => null)) ?? {},
    putSourceProfiles: (profiles) =>
      db.put(SOURCE_PROFILES_KEY, profiles, { valueEncoding: "json" }),
    getGames: () => gamesSublevel.iterator().all(),
    replaceGames: (entries: [string, Game][]) =>
      replaceSublevel(gamesSublevel, entries),
    getExcludedGames: () => excludedLibraryGamesSublevel.iterator().all(),
    replaceExcludedGames: (entries: [string, ExcludedLibraryGame][]) =>
      replaceSublevel(excludedLibraryGamesSublevel, entries),
    getCloudSaveCustomPaths: () =>
      cloudSaveCustomPathsSublevel.iterator().all(),
    replaceCloudSaveCustomPaths: (entries: [string, unknown][]) =>
      replaceSublevel(cloudSaveCustomPathsSublevel, entries),
    getCloudSaveAutomaticSync: () =>
      cloudSaveAutomaticSyncSettingsSublevel.iterator().all(),
    replaceCloudSaveAutomaticSync: (entries: [string, boolean][]) =>
      replaceSublevel(cloudSaveAutomaticSyncSettingsSublevel, entries),
  };
}

async function assertLiveRestoreGuards(
  settings: LudusaviLocalSettings,
  adapter: HydraConfigStoreAdapter
) {
  if (hasTrackedGamesRunning()) {
    throw new Error("Stop running games before restoring Hydra configuration.");
  }
  if (DownloadManager.hasActiveDownload()) {
    throw new Error(
      "Pause or finish active downloads before restoring Hydra configuration."
    );
  }
  const games = await adapter.getGames();
  const scan = await NativeAddon.getSystemProcessMap().catch(() => null);
  if (scan?.processTree?.length) {
    for (const [, game] of games) {
      if (!game.isDeleted) {
        await tools.assertStopped(game, settings, false, scan);
      }
    }
  }
}

async function applyLiveRestoreSideEffects({
  previousLanguage,
  newLanguage,
  newPreferences,
  appliedSections,
}: {
  previousLanguage: string | null;
  newLanguage: string | null;
  previousPreferences: UserPreferences | null;
  newPreferences: UserPreferences | null;
  appliedSections: HydraConfigRestoreResult["appliedSections"];
}) {
  if (appliedSections.includes("preferences") && newPreferences) {
    if (newLanguage && newLanguage !== previousLanguage) {
      await i18next.changeLanguage(newLanguage);
    }
    await setDirectTorrentAccess(allowsDirectTorrent(newPreferences));
    Wine.syncUserPreferences(newPreferences);
    ScreenshotInputService.syncUserPreferences(newPreferences);
    GamepadWakeService.syncUserPreferences(newPreferences);
    BigPictureGameWindowService.syncUserPreferences(newPreferences);
    achievementNotificationPresenter.dispose();
    await applyAutoLaunch({
      enabled: Boolean(newPreferences.runAtStartup),
      minimized: Boolean(newPreferences.startMinimized),
    });
    await DownloadManager.applyDownloadSpeedLimit(
      newPreferences.maxDownloadSpeedBytesPerSecond ?? null
    );
    await DownloadManager.applyNetworkInterface(
      newPreferences.torrentNetworkInterface ?? null
    );
    WindowManager.sendToAppWindows(
      "on-user-preferences-updated",
      newPreferences
    );
  }

  if (appliedSections.includes("themes")) {
    achievementNotificationPresenter.notifyThemeUpdated();
    WindowManager.sendToAppWindows("on-custom-theme-updated");
  }

  if (appliedSections.includes("ludusavi")) {
    WindowManager.sendToAppWindows("on-ludusavi-state-changed");
  }

  WindowManager.sendToAppWindows("on-hydra-config-restored", appliedSections);
}

const asSaveEngineContext = (ctx: ConfigEngineContext): SaveEngineContext =>
  ctx as unknown as SaveEngineContext;

let liveController: HydraConfigBackupController | undefined;

function getLiveController(): HydraConfigBackupController {
  if (!liveController) {
    const adapter = createLiveConfigStoreAdapter();
    liveController = new HydraConfigBackupController({
      adapter,
      engine: {
        runJson: (ctx, args) => runSaveToolJson(asSaveEngineContext(ctx), args),
        backupsForCanonical: (ctx, rootPath) =>
          backupsForCanonical(asSaveEngineContext(ctx), rootPath),
        restoreDataForCanonical: (ctx, version, rootPath) =>
          restoreDataForCanonical(asSaveEngineContext(ctx), version, rootPath),
        validateArchive: (ctx, version, rootPath) =>
          validateCanonicalBackupVersion(
            asSaveEngineContext(ctx),
            version,
            rootPath
          ),
        listSafetySnapshots: (ctx) =>
          listSafetySnapshotsForCanonical(asSaveEngineContext(ctx)),
        cloudDataForCanonical: (ctx, direction, preview) =>
          cloudDataForCanonical(asSaveEngineContext(ctx), direction, preview),
      },
      snapshotDir: snapshotDirectory,
      scratchRoot: () => path.join(tools.folder(), ".tmp"),
      binaryPath: () => tools.binaryPath(),
      readBaseSaveConfig: async (settings) => {
        const prepared = await tools.prepareBaseConfig(settings);
        return prepared.config;
      },
      getSettings: getLudusaviLocalSettings,
      acquireLock: acquireSaveBackupLock,
      enqueue: (key, task) => tools.queue.enqueue(key, task),
      withPreferencesLock: withUserPreferencesLock,
      assertSafeForRestore: assertLiveRestoreGuards,
      applySideEffects: applyLiveRestoreSideEffects,
      getRecord: async () =>
        (await db
          .get<
            string,
            HydraConfigBackupRecord | null
          >(CONFIG_BACKUP_RECORD_KEY, { valueEncoding: "json" })
          .catch(() => null)) ?? defaultRecord(),
      saveRecord: (record) =>
        db.put(CONFIG_BACKUP_RECORD_KEY, record, { valueEncoding: "json" }),
    });
  }
  return liveController;
}

export const getHydraConfigBackupState = () => getLiveController().getState();
export const backupHydraConfig = (preview = false) =>
  getLiveController().backupNow(preview);
export const validateHydraConfigBackup = (
  version: string,
  snapshotId?: string
) => getLiveController().validateBackup(version, snapshotId);
export const previewHydraConfigRestore = (
  owner: number,
  version: string,
  snapshotId?: string
) => getLiveController().previewRestore(owner, version, snapshotId);
export const confirmHydraConfigRestore = (
  owner: number,
  request: HydraConfigRestoreRequest
) => getLiveController().confirmRestore(owner, request);
export const previewHydraConfigCloudTransfer = (
  direction: "upload" | "download"
) => getLiveController().previewCloudTransfer(direction);
export const confirmHydraConfigCloudTransfer = (token: string) =>
  getLiveController().confirmCloudTransfer(token);
