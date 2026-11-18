import { registerEvent } from "./register-event";
import {
  scanDetectedSaveGames,
  addDetectedSaveGame,
  getSaveDiscoveryProgress,
} from "../services/ludusavi-local-discovery";
import { enrichDetectedSaveGames } from "../services/ludusavi-metadata-enrichment";
import { addGameToLibrary } from "./library/add-game-to-library";
import { addCustomGameToLibrary } from "./library/add-custom-game-to-library";
import { gamesShopAssetsSublevel, levelKeys } from "@main/level";
import { AchievementWatcherManager } from "../services/achievements/achievement-watcher-manager";
import { logger } from "../services/logger";
import {
  listSaveBackupVersions,
  previewSaveRestore,
  confirmSaveOperation,
  validateSaveBackup,
  previewSaveCloudTransfer,
  getSaveAdvancedConfig,
  saveSaveAdvancedConfig,
  importStandaloneSaveConfig,
  updateSaveManifest,
  openFullSaveManager,
} from "../services/ludusavi-local-manager";
import {
  getLudusaviLocalState,
  saveLudusaviLocalSettings,
  saveLudusaviGameSettings,
  enqueueLudusaviLocalBackup,
  runLudusaviLocalBulkBackup,
  openLudusaviLocalFolder,
  clearLudusaviLocalLogs,
} from "../services/ludusavi-local";
import {
  getHydraConfigBackupState,
  backupHydraConfig,
  validateHydraConfigBackup,
  previewHydraConfigRestore,
  confirmHydraConfigRestore,
  previewHydraConfigCloudTransfer,
  confirmHydraConfigCloudTransfer,
} from "../services/hydra-config-backup";
import {
  getLocalReleases,
  getReleaseSourceChanges,
  getReleaseSourceFile,
  getLocalUpdateState,
  checkLocalReleaseUpdate,
  downloadLocalReleaseUpdate,
  installLocalReleaseUpdate,
} from "../services/local-releases";
import {
  clearExcludedLibraryGames,
  getExcludedLibraryGames,
  unexcludeLibraryGames,
} from "../services/library-exclusions";
import {
  excludeLibraryGames,
  restoreExcludedLibraryGames,
} from "../helpers/exclude-library-games";

registerEvent("getLudusaviLocalState", () => getLudusaviLocalState());
registerEvent("saveLudusaviLocalSettings", (_event, settings) =>
  saveLudusaviLocalSettings(settings)
);
registerEvent("saveLudusaviGameSettings", (_event, key, patch) =>
  saveLudusaviGameSettings(key, patch)
);
registerEvent("runLudusaviLocalBackup", (_event, key, preview) =>
  enqueueLudusaviLocalBackup(key, preview)
);
registerEvent(
  "runLudusaviLocalBulkBackup",
  (_event, includeDisabled, includeHydraConfig) =>
    runLudusaviLocalBulkBackup(
      includeDisabled,
      includeHydraConfig ? () => backupHydraConfig(false) : undefined
    )
);
registerEvent("openLudusaviLocalFolder", (_event, logs) =>
  openLudusaviLocalFolder(logs)
);
registerEvent("clearLudusaviLocalLogs", () => clearLudusaviLocalLogs());
registerEvent("scanDetectedSaveGames", (_event, source) =>
  scanDetectedSaveGames(source, enrichDetectedSaveGames)
);
registerEvent("getSaveDiscoveryProgress", () => getSaveDiscoveryProgress());
registerEvent("addDetectedSaveGame", (event, request) =>
  addDetectedSaveGame(request, {
    allowUninstalledCustom: true,
    addSteam: (id, title) => addGameToLibrary(event, "steam", id, title),
    addStore: async (shop, objectId, title, entry) => {
      const gameKey = levelKeys.game(shop, objectId);
      const existingAssets = await gamesShopAssetsSublevel
        .get(gameKey)
        .catch(() => null);
      if (
        !existingAssets &&
        (entry.iconUrl ||
          entry.coverImageUrl ||
          entry.libraryHeroImageUrl ||
          entry.logoImageUrl)
      ) {
        const now = Date.now();
        await gamesShopAssetsSublevel
          .put(gameKey, {
            title,
            shop,
            objectId,
            iconUrl: entry.iconUrl ?? null,
            coverImageUrl: entry.coverImageUrl ?? "",
            libraryHeroImageUrl: entry.libraryHeroImageUrl ?? "",
            logoImageUrl: entry.logoImageUrl ?? "",
            libraryImageUrl: entry.libraryHeroImageUrl ?? "",
            logoPosition: null,
            downloadSources: [],
            updatedAt: now,
            ...(shop === "epic"
              ? {
                  epicArtworkUpdatedAtByType: {
                    icon: now,
                    portrait: now,
                    landscape: now,
                  },
                }
              : {}),
          })
          .catch(() => {});
      }
      await addGameToLibrary(event, shop, objectId, title);
      return gameKey;
    },
    addCustom: async (title, executable, entry) => {
      const game = await addCustomGameToLibrary(
        event,
        title,
        executable || null,
        entry?.iconUrl ?? null,
        entry?.logoImageUrl ?? null,
        entry?.libraryHeroImageUrl ?? null,
        entry?.coverImageUrl ?? null
      );
      return `${game.shop}:${game.objectId}`;
    },
    executableAssigned: async (shop, objectId) => {
      try {
        await AchievementWatcherManager.syncGameAchievementFiles(
          shop,
          objectId
        );
      } catch (error) {
        logger.warn(
          "Could not refresh achievement files after adding a detected game",
          error
        );
      }
    },
  })
);
registerEvent("listSaveBackupVersions", (_event, key) =>
  listSaveBackupVersions(key)
);
registerEvent("previewSaveRestore", (_event, key, version, snapshotId) =>
  previewSaveRestore(key, version, snapshotId)
);
registerEvent("confirmSaveOperation", (_event, token) =>
  confirmSaveOperation(token)
);
registerEvent("validateSaveBackup", (_event, key, version, snapshotId) =>
  validateSaveBackup(key, version, snapshotId)
);
registerEvent("previewSaveCloudTransfer", (_event, key, direction) =>
  previewSaveCloudTransfer(key, direction)
);
registerEvent("getSaveAdvancedConfig", () => getSaveAdvancedConfig());
registerEvent("saveSaveAdvancedConfig", (_event, text) =>
  saveSaveAdvancedConfig(text)
);
registerEvent("importStandaloneSaveConfig", () => importStandaloneSaveConfig());
registerEvent("updateSaveManifest", () => updateSaveManifest());
registerEvent("openFullSaveManager", (_event, key) => openFullSaveManager(key));
registerEvent("getHydraConfigBackupState", () => getHydraConfigBackupState());
registerEvent("backupHydraConfig", (_event, preview) =>
  backupHydraConfig(Boolean(preview))
);
registerEvent("validateHydraConfigBackup", (_event, version, snapshotId) =>
  validateHydraConfigBackup(version, snapshotId)
);
registerEvent("previewHydraConfigRestore", (event, version, snapshotId) =>
  previewHydraConfigRestore(event.sender.id, version, snapshotId)
);
registerEvent("confirmHydraConfigRestore", (event, request) =>
  confirmHydraConfigRestore(event.sender.id, request)
);
registerEvent("previewHydraConfigCloudTransfer", (_event, direction) =>
  previewHydraConfigCloudTransfer(direction)
);
registerEvent("confirmHydraConfigCloudTransfer", (_event, token) =>
  confirmHydraConfigCloudTransfer(token)
);
registerEvent("getLocalReleases", (_event, force) => getLocalReleases(force));
registerEvent("getReleaseSourceChanges", (_event, tag) =>
  getReleaseSourceChanges(tag)
);
registerEvent("getReleaseSourceFile", (_event, tag, file) =>
  getReleaseSourceFile(tag, file)
);
registerEvent("getLocalUpdateState", () => getLocalUpdateState());
registerEvent("checkLocalReleaseUpdate", () => checkLocalReleaseUpdate());
registerEvent("downloadLocalReleaseUpdate", () => downloadLocalReleaseUpdate());
registerEvent("installLocalReleaseUpdate", () => installLocalReleaseUpdate());
registerEvent("getExcludedLibraryGames", () => getExcludedLibraryGames());
registerEvent("excludeLibraryGames", (_event, inputs) =>
  excludeLibraryGames(inputs)
);
registerEvent(
  "unexcludeLibraryGames",
  async (_event, targets, options?: { restoreToLibrary?: boolean }) => {
    if (options?.restoreToLibrary) {
      return restoreExcludedLibraryGames(targets);
    }
    const result = await unexcludeLibraryGames(targets);
    return { ...result, restoredCount: 0 };
  }
);
registerEvent("clearExcludedLibraryGames", () => clearExcludedLibraryGames());
