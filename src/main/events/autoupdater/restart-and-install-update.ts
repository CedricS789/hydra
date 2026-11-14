import { app } from "electron";
import { registerEvent } from "../register-event";
import updater from "electron-updater";
import { assertLocalUpdateSafe } from "@main/services/local-releases";

const { autoUpdater } = updater;

export const restartAndInstallUpdate = async () => {
  await assertLocalUpdateSafe();
  autoUpdater.removeAllListeners();
  if (app.isPackaged) {
    autoUpdater.quitAndInstall(false);
  }
};

const restartAndInstallUpdateEvent = async (
  _event: Electron.IpcMainInvokeEvent
) => restartAndInstallUpdate();

registerEvent("restartAndInstallUpdate", restartAndInstallUpdateEvent);
