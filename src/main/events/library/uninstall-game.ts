import { registerEvent } from "../register-event";
import { gameUninstallService } from "@main/services/uninstall/game-uninstall-service";
import type {
  ExecuteGameUninstallOptions,
  ExecuteGameUninstallResult,
  GameShop,
} from "@types";

const uninstallGame = async (
  _event: Electron.IpcMainInvokeEvent,
  shop: GameShop,
  objectId: string,
  options: ExecuteGameUninstallOptions
): Promise<ExecuteGameUninstallResult> =>
  gameUninstallService.executeGameUninstall(shop, objectId, options);

registerEvent("uninstallGame", uninstallGame);
