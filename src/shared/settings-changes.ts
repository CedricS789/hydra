import type { UserPreferences } from "../types/level.types";

// Values are intentionally never included in reviews: preferences contain tokens.
const labels: Partial<Record<keyof UserPreferences, string>> = {
  companionAppsEnabled: "Run apps with games",
  companionApps: "Companion apps",
  allowDirectTorrent: "Direct peer-to-peer torrent access",
  seedAfterDownloadComplete: "Torrent seeding",
  torrentNetworkInterface: "Torrent network interface",
  httpParallelDownloadsEnabled: "Multi-connection HTTP downloads",
  httpParallelConnections: "Connections per HTTP download",
  httpRangeSizeMb: "HTTP byte-range chunk size (MB, 0 = Auto)",
  httpStallTimeoutSeconds: "HTTP stall timeout (seconds)",
  httpCheckpointIntervalSeconds: "HTTP disk checkpoint interval (seconds)",
  httpMaxRetryAttempts: "HTTP max consecutive retries",
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
  showHydraAchievementPoints: "Hydra achievement points",
  screenshotsEnabled: "Screenshot capture",
  screenshotDefaultVisibility: "Default screenshot visibility",
  bigPictureGamepadWakeEnabled: "Open Big Picture with controller",
  bigPictureGamepadWakeMode: "Controller wake trigger",
  bigPictureGamepadWakeCombo: "Controller wake button combo",
  bigPictureHomeButtonAction: "Home button action in Big Picture",
  bigPictureControllerLedEnabled: "PlayStation controller lightbar & LEDs",
  bigPictureControllerLedColor: "PlayStation controller LED color",
  bigPictureControllerLedCustomColors: "Saved custom controller LED colors",
  showLeaderboardsAndRankings: "Leaderboards & rankings visibility",
  showGlobalLeaderboards: "Global Leaderboards page & sidebar link",
  showGameRankingCard: "Game page ranking card",
  showLeaderboardAlerts: "Leaderboard rank-change alerts",
  showLeaderboardMetricPlaytime: "Leaderboard category: Playtime",
  showLeaderboardMetricAchievements:
    "Leaderboard category: Achievements (Trophies)",
  showLeaderboardMetricGames: "Leaderboard category: Games",
  showLeaderboardMetricStreak: "Leaderboard category: Streak",
  showLeaderboardMetricSessions: "Leaderboard category: Sessions",
  showLeaderboardMetricSouvenirs: "Leaderboard category: Souvenirs",
  showLeaderboardMetricReviews: "Leaderboard category: Reviews",
  showLeaderboardMetricFriends: "Leaderboard category: Friends",
  showOtherPlayersPlaytime: "Other players' playtime (profiles & reviews)",
  showActivePlayerCounts: "Active player counts (Playing now)",
  showCommunityReviews: "Community reviews & review prompts",
  showCommunityStarRatings: "Community star ratings (average score)",
  hideCommunityScreenshots: "Hide community screenshots",
  showFriendsAndChat: "Friends, chat & social notifications",
  showFriends: "Friends & friend activity",
  showChatAndMessages: "Direct chat & unread message badges",
  showNotificationsMenu: "Sidebar notifications menu",
  showAccountProfileHeader: "Sidebar account & profile header",
  enableDangerZone: "Title Danger Zone tab",
  enableDangerZoneChangePlaytime: "Danger Zone: Change playtime",
  enableDangerZoneResetPlaytime: "Danger Zone: Reset playtime",
  enableDangerZoneResetAchievements: "Danger Zone: Reset achievements",
  enableDangerZoneRemoveGameFiles: "Danger Zone: Remove game files",
  enableDangerZoneRemoveFromLibrary: "Danger Zone: Remove from library",
  enableDangerZoneDeleteScreenshots: "Danger Zone: Delete screenshots",
  showManualPlaytimeWarningIcon: "Manual playtime warning icon",
  showManualPlaytimeWarningText: "Manual playtime warning text & tooltips",
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
