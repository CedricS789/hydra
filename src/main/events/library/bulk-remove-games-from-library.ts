import { registerEvent } from "../register-event";
import { downloadsSublevel, gamesSublevel, levelKeys } from "@main/level";
import { removeLibraryGame } from "@main/helpers/remove-library-game";
import { executeBulkRemoveLibraryGames } from "@main/helpers/bulk-remove-library-games-core";
import { isGameRunning } from "@main/services/game-running-state";
import { hasManagedEpicSession } from "@main/services/epic/launch";
import {
  isLibraryGameDownloading,
  type BulkLibraryRemovalTarget,
} from "@shared";

const bulkRemoveGamesFromLibrary = async (
  _event: Electron.IpcMainInvokeEvent,
  targets: BulkLibraryRemovalTarget[],
  confirmation?: string
) =>
  executeBulkRemoveLibraryGames(targets, confirmation, {
    getGame: (shop, objectId) =>
      gamesSublevel.get(levelKeys.game(shop, objectId)),
    getDownload: (shop, objectId) =>
      downloadsSublevel.get(levelKeys.game(shop, objectId)),
    isGameActive: (shop, objectId) =>
      isGameRunning(objectId, shop) ||
      hasManagedEpicSession(levelKeys.game(shop, objectId)),
    isGameDownloading: (download) => isLibraryGameDownloading({ download }),
    removeGame: removeLibraryGame,
  });

registerEvent("bulkRemoveGamesFromLibrary", bulkRemoveGamesFromLibrary);
