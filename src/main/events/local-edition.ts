import { registerEvent } from "./register-event";
import {
  scanDetectedSaveGames,
  addDetectedSaveGame,
} from "../services/ludusavi-local-discovery";
import { addGameToLibrary } from "./library/add-game-to-library";
import { addCustomGameToLibrary } from "./library/add-custom-game-to-library";
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
  enqueueLudusaviLocalBackup,
  openLudusaviLocalFolder,
  clearLudusaviLocalLogs,
} from "../services/ludusavi-local";
import {
  getLocalReleases,
  getReleaseSourceChanges,
  getReleaseSourceFile,
  getLocalUpdateState,
  checkLocalReleaseUpdate,
  downloadLocalReleaseUpdate,
  installLocalReleaseUpdate,
} from "../services/local-releases";

registerEvent("getLudusaviLocalState", () => getLudusaviLocalState());
registerEvent("saveLudusaviLocalSettings", (_event, settings) =>
  saveLudusaviLocalSettings(settings)
);
registerEvent("runLudusaviLocalBackup", (_event, key, preview) =>
  enqueueLudusaviLocalBackup(key, preview)
);
registerEvent("openLudusaviLocalFolder", (_event, logs) =>
  openLudusaviLocalFolder(logs)
);
registerEvent("clearLudusaviLocalLogs", () => clearLudusaviLocalLogs());
registerEvent("scanDetectedSaveGames", (_event, source) =>
  scanDetectedSaveGames(source)
);
registerEvent("addDetectedSaveGame", (event, request) =>
  addDetectedSaveGame(request, {
    addSteam: (id, title) => addGameToLibrary(event, "steam", id, title),
    addCustom: async (title, executable) => {
      const game = await addCustomGameToLibrary(event, title, executable);
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
registerEvent("previewSaveRestore", (_event, key, version) =>
  previewSaveRestore(key, version)
);
registerEvent("confirmSaveOperation", (_event, token) =>
  confirmSaveOperation(token)
);
registerEvent("validateSaveBackup", (_event, key, version) =>
  validateSaveBackup(key, version)
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
