import type { UserPreferences } from "../types/level.types";

// Values are intentionally never included in reviews: preferences contain tokens.
const labels: Partial<Record<keyof UserPreferences, string>> = {
  allowDirectTorrent: "Direct peer-to-peer torrent access",
  seedAfterDownloadComplete: "Torrent seeding",
  torrentNetworkInterface: "Torrent network interface",
  enableSourceBrowser: "Source website browsing",
  downloadOptionInteraction: "Download option interaction",
  runAtStartup: "Start with Windows / system login",
  startMinimized: "Start minimized",
  downloadsPath: "Default download folder",
  downloadDirectories: "Saved download folders",
  enableAutoInstall: "Automatic installation",
  deleteArchiveFilesAfterExtractionByDefault:
    "Delete archives after extraction",
  realDebridApiToken: "Real-Debrid connection (token hidden)",
  allDebridApiToken: "AllDebrid connection (token hidden)",
  premiumizeApiToken: "Premiumize connection (token hidden)",
  torBoxApiToken: "TorBox connection (token hidden)",
  enableClassics: "Hydra Classics",
  enableTransferGame: "Transfer Game",
  screenshotsEnabled: "Screenshot capture",
  screenshotDefaultVisibility: "Default screenshot visibility",
};

const sensitive: Partial<Record<keyof UserPreferences, string>> = {
  allowDirectTorrent:
    "Changes whether this PC may connect directly to torrent peers. Your public IP can be visible to them.",
  seedAfterDownloadComplete:
    "Seeding shares downloaded data with torrent peers.",
  torrentNetworkInterface:
    "Changes the network used for direct torrent traffic.",
  enableSourceBrowser:
    "Disabling closes source windows and discards unsubmitted links. Existing downloads continue.",
  enableAutoInstall:
    "Automatic installation may execute downloaded installers.",
  deleteArchiveFilesAfterExtractionByDefault:
    "Archives may be deleted after successful extraction.",
  realDebridApiToken:
    "Changes the provider used for downloads. Direct torrents remain subject to their separate protection.",
  allDebridApiToken: "Changes the provider used for downloads.",
  premiumizeApiToken: "Changes the provider used for downloads.",
  torBoxApiToken: "Changes the provider used for downloads.",
  screenshotDefaultVisibility:
    "Changes who can see future uploaded screenshots.",
};

export function settingsValueEqual(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true;
  if (!left || !right || typeof left !== "object" || typeof right !== "object")
    return false;
  if (Array.isArray(left) !== Array.isArray(right)) return false;
  const a = Object.keys(left);
  const b = Object.keys(right);
  return (
    a.length === b.length &&
    a.every(
      (key) =>
        Object.hasOwn(right, key) && settingsValueEqual(left[key], right[key])
    )
  );
}

export function changedSettings(
  saved: Partial<UserPreferences> | null,
  patch: Partial<UserPreferences>
): Partial<UserPreferences> {
  return Object.fromEntries(
    Object.entries(patch).filter(
      ([key, value]) => !settingsValueEqual(saved?.[key], value)
    )
  );
}

export function reviewSettings(patch: Partial<UserPreferences>): string[] {
  return (Object.keys(patch) as (keyof UserPreferences)[]).map((key) => {
    const label =
      labels[key] ??
      key
        .replace(/([a-z])([A-Z])/g, "$1 $2")
        .replace(/^./, (c) => c.toUpperCase());
    const value = patch[key];
    const selection =
      typeof value === "boolean"
        ? `: ${value ? "On" : "Off"}`
        : typeof value === "number"
          ? `: ${value}`
          : [
                "language",
                "downloadOptionInteraction",
                "screenshotDefaultVisibility",
              ].includes(key)
            ? `: ${String(value)}`
            : "";
    const summary = `${label}${selection}`;
    return sensitive[key] ? `${summary}. ${sensitive[key]}` : summary;
  });
}
