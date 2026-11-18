import { registerEvent } from "../register-event";
import { gameUninstallService } from "@main/services/uninstall/game-uninstall-service";
import type { GameShop, GameUninstallPlan } from "@types";

const inspectGameUninstall = async (
  _event: Electron.IpcMainInvokeEvent,
  shop: GameShop,
  objectId: string
): Promise<GameUninstallPlan> =>
  gameUninstallService.inspectGameUninstall(shop, objectId);

registerEvent("inspectGameUninstall", inspectGameUninstall);
