import { app } from "electron";
import { WindowManager } from "@main/services/window-manager";
import { registerEvent } from "../register-event";
import { executeBigPictureQuitApp } from "./quit-app-handler";

registerEvent("quitApp", (event) => {
  executeBigPictureQuitApp(event, {
    isBigPictureSender: (sender) => WindowManager.isBigPictureSender(sender),
    quit: () => app.quit(),
  });
});
