import { registerEvent } from "./register-event";
import {
  getLudusaviLocalState,
  saveLudusaviLocalSettings,
  enqueueLudusaviLocalBackup,
  openLudusaviLocalFolder,
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
