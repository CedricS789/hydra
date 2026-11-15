import { registerEvent } from "../register-event";
import AutoLaunch from "auto-launch";
import { app } from "electron";

const autoLaunch = async (
  _event: Electron.IpcMainInvokeEvent,
  autoLaunchProps: { enabled: boolean; minimized: boolean }
) => {
  await applyAutoLaunch(autoLaunchProps);
};

export const applyAutoLaunch = async (autoLaunchProps: {
  enabled: boolean;
  minimized: boolean;
}) => {
  if (!app.isPackaged) return;

  const appLauncher = new AutoLaunch({
    name: app.getName(),
    isHidden: autoLaunchProps.minimized,
  });

  if (autoLaunchProps.enabled) {
    await appLauncher.enable();
  } else {
    await appLauncher.disable();
  }
};

registerEvent("autoLaunch", autoLaunch);
