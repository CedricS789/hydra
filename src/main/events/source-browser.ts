import { registerEvent } from "./register-event";
import {
  assertSourceBrowserEnabled,
  assertSourceBrowserOwner,
  openSourceBrowser,
  getSourceWebsiteProfiles,
  saveSourceWebsiteProfile,
  clearSourceWebsiteData,
} from "../services/source-browser";

registerEvent("openSourceBrowser", openSourceBrowser);
registerEvent("getSourceWebsiteProfiles", async (event) => {
  assertSourceBrowserOwner(event);
  await assertSourceBrowserEnabled();
  return getSourceWebsiteProfiles();
});
registerEvent("saveSourceWebsiteProfile", async (event, id, profile) => {
  assertSourceBrowserOwner(event);
  await saveSourceWebsiteProfile(id, profile);
});
registerEvent("clearSourceWebsiteData", async (event, id) => {
  assertSourceBrowserOwner(event);
  await clearSourceWebsiteData(id);
});
