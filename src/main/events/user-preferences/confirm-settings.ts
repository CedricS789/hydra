import { BrowserWindow, dialog } from "electron";
import { registerEvent } from "../register-event";
import { WindowManager } from "@main/services/window-manager";

registerEvent(
  "confirmSettingsChanges",
  async (event, kind: "save" | "discard", changes: string[]) => {
    const owner = BrowserWindow.fromWebContents(event.sender);
    if (
      !owner ||
      (owner !== WindowManager.mainWindow &&
        owner !== WindowManager.bigPictureWindow) ||
      event.senderFrame !== event.sender.mainFrame
    )
      throw new Error(
        "Settings confirmation is only available in the launcher."
      );
    if (
      !["save", "discard"].includes(kind) ||
      !Array.isArray(changes) ||
      changes.length > 100 ||
      changes.some((item) => typeof item !== "string" || item.length > 1000)
    )
      throw new Error("Invalid settings review.");
    const result = await dialog.showMessageBox(owner, {
      type: "warning",
      title: kind === "save" ? "Review settings changes" : "Unsaved settings",
      message:
        kind === "save"
          ? "Save these changes?"
          : "Discard unsaved edits and continue?",
      detail: changes.map((item) => `• ${item}`).join("\n"),
      buttons: [
        "Keep editing",
        kind === "save" ? "Save changes" : "Discard edits",
      ],
      defaultId: 0,
      cancelId: 0,
      noLink: true,
    });
    return result.response === 1;
  }
);
