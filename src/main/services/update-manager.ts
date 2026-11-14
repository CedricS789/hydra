import { app } from "electron";
import { checkLocalReleaseUpdate } from "./local-releases";

/** The custom build checks its own releases and downloads only on request. */
export class UpdateManager {
  public static async checkForUpdates() {
    if (app.isPackaged) await checkLocalReleaseUpdate();
    return (
      process.platform === "win32" &&
      process.env.PORTABLE_EXECUTABLE_FILE == null
    );
  }
}
