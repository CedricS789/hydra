import { shell } from "electron";
import { GamepadWakeService } from "@main/services/gamepad-wake";
import { WindowManager } from "@main/services/window-manager";
import { registerEvent } from "../register-event";

GamepadWakeService.onStatusChange((status) => {
  WindowManager.sendToAppWindows(
    "on-big-picture-gamepad-wake-status-change",
    status
  );
});

registerEvent("getBigPictureGamepadWakeStatus", () =>
  GamepadWakeService.refreshStatus()
);

registerEvent("openWindowsGameBarSettings", async () => {
  if (process.platform !== "win32") return false;
  await shell.openExternal("ms-settings:gaming-gamebar");
  return true;
});
