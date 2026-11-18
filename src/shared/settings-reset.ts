import type { UserPreferences } from "../types/level.types";
import {
  DEFAULT_SCREENSHOT_HOTKEY,
  DEFAULT_SCREENSHOT_GAMEPAD_COMBO,
} from "./screenshot-input.js";
import {
  DEFAULT_BIG_PICTURE_CONTROLLER_LED_COLOR,
  DEFAULT_BIG_PICTURE_CONTROLLER_LED_ENABLED,
  DEFAULT_BIG_PICTURE_GAME_WINDOW_MODE,
  DEFAULT_BIG_PICTURE_GAMEPAD_WAKE_COMBO,
  DEFAULT_BIG_PICTURE_GAMEPAD_WAKE_ENABLED,
  DEFAULT_BIG_PICTURE_GAMEPAD_WAKE_MODE,
  DEFAULT_BIG_PICTURE_HOME_BUTTON_ACTION,
} from "./big-picture-gamepad.js";
import { settingsValueEqual } from "./settings-changes.js";
import { HTTP_DOWNLOAD_DEFAULTS } from "./http-download-settings.js";

// Explicit allowlists: adding a preference never silently adds it to a reset.
export const SETTINGS_RESET_GROUPS = {
  general: {
    title: "General behavior",
    description: "Startup, minimize, close and navigation behavior.",
    defaults: {
      preferQuitInsteadOfHiding: false,
      runAtStartup: false,
      startMinimized: false,
      hideToTrayOnGameStart: false,
      launchToLibraryPage: false,
      openFriendsWindowOnStartup: false,
      useNativeWindowDecorations: false,
    },
  },
  appearance: {
    title: "Appearance and library display",
    description:
      "Display preferences and active theme. Installed themes are kept.",
    defaults: {
      autoplayGameTrailers: true,
      alwaysMuteTrailersByDefault: false,
      enableNewDownloadOptionsBadges: true,
      hideClassicsBookmark: false,
      classicsUseHeroLayout: false,
      hideLibraryGameBadges: false,
      hideLibraryReadySizeBadges: false,
      hideLibraryClassicsBadges: false,
      hideSteamLibraryBadges: false,
      hideEpicLibraryBadges: false,
      hideLibraryAchievementProgress: false,
      autoplayAnimatedArtwork: false,
      persistFiltersAndSorting: false,
    },
  },
  notifications: {
    title: "Notifications",
    description:
      "Local notifications, sounds, volume and placement. Online account preferences are kept.",
    defaults: {
      downloadNotificationsEnabled: false,
      repackUpdatesNotificationsEnabled: false,
      friendRequestNotificationsEnabled: false,
      friendStartGameNotificationsEnabled: true,
      chatMessageNotificationsEnabled: true,
      leaderboardSlamEnabled: true,
      leaderboardDropNotificationsEnabled: true,
      achievementNotificationsEnabled: true,
      achievementCustomNotificationsEnabled: true,
      achievementCustomNotificationPosition: "top-left",
      achievementSoundVolume: 0.15,
    },
  },
  bigPicture: {
    title: "Big Picture",
    description: "Sounds, keyboard, diagnostics and startup behavior.",
    defaults: {
      launchInBigPicture: false,
      bigPictureLaunchToLibraryPage: false,
      bigPictureSoundsEnabled: true,
      bigPictureVirtualKeyboardEnabled: true,
      bigPictureDiagnosticsEnabled: false,
      bigPictureDiagnosticsPosition: "bottom-center",
      bigPictureGamepadWakeEnabled: DEFAULT_BIG_PICTURE_GAMEPAD_WAKE_ENABLED,
      bigPictureGamepadWakeMode: DEFAULT_BIG_PICTURE_GAMEPAD_WAKE_MODE,
      bigPictureGamepadWakeCombo: [...DEFAULT_BIG_PICTURE_GAMEPAD_WAKE_COMBO],
      bigPictureHomeButtonAction: DEFAULT_BIG_PICTURE_HOME_BUTTON_ACTION,
      bigPictureGameWindowMode: DEFAULT_BIG_PICTURE_GAME_WINDOW_MODE,
      bigPictureControllerLedEnabled:
        DEFAULT_BIG_PICTURE_CONTROLLER_LED_ENABLED,
      bigPictureControllerLedColor: DEFAULT_BIG_PICTURE_CONTROLLER_LED_COLOR,
      bigPictureControllerLedCustomColors: [] as string[],
    },
  },
  screenshots: {
    title: "Screenshot controls",
    description:
      "Capture controls, shortcuts, sound and notifications. Folders and upload visibility are kept.",
    defaults: {
      screenshotsEnabled: true,
      screenshotHotkey: { ...DEFAULT_SCREENSHOT_HOTKEY },
      screenshotGamepadEnabled: true,
      screenshotGamepadCombo: [...DEFAULT_SCREENSHOT_GAMEPAD_COMBO],
      screenshotCaptureSoundEnabled: true,
      screenshotToastEnabled: true,
    },
  },
  websites: {
    title: "Website browsing",
    description:
      "Browsing enabled, native download interaction and default search ordering. Profiles, cookies and feeds are kept.",
    defaults: {
      enableSourceBrowser: true,
      downloadOptionInteraction: "native",
      sourceWebsiteSearchOrder: [],
    },
  },
  downloads: {
    title: "Download preferences",
    description:
      "Speed units, speed limit, extraction and shortcuts. Folders, automatic installation and archive-deletion permissions are kept.",
    defaults: {
      showDownloadSpeedInMegabytes: false,
      maxDownloadSpeedBytesPerSecond: null,
      extractFilesByDefault: true,
      createStartMenuShortcut: true,
      ...HTTP_DOWNLOAD_DEFAULTS,
    },
  },
  features: {
    title: "Optional features",
    description:
      "Hydra Classics, Transfer Game, and Hydra achievement points availability. Emulator setup and game locations are kept.",
    defaults: {
      enableClassics: true,
      enableTransferGame: true,
      showHydraAchievementPoints: false,
    },
  },
  dangerZone: {
    title: "Title Danger Zone",
    description:
      "Show the Danger Zone tab in title settings, re-enable its individual destructive actions, and show manual playtime warnings.",
    defaults: {
      enableDangerZone: true,
      enableDangerZoneChangePlaytime: true,
      enableDangerZoneResetPlaytime: true,
      enableDangerZoneResetAchievements: true,
      enableDangerZoneRemoveGameFiles: true,
      enableDangerZoneRemoveFromLibrary: true,
      enableDangerZoneDeleteScreenshots: true,
      showManualPlaytimeWarningIcon: true,
      showManualPlaytimeWarningText: true,
    },
  },
  protection: {
    title: "Download protection",
    description:
      "Block direct torrents and disable seeding. Active direct torrent transfers will be suspended.",
    defaults: { allowDirectTorrent: false, seedAfterDownloadComplete: false },
  },
  social: {
    title: "Social visibility",
    description:
      "Show local social and community features again. This changes visibility in the app, not online profile privacy.",
    defaults: {
      showLeaderboardsAndRankings: true,
      showGlobalLeaderboards: true,
      showGameRankingCard: true,
      showLeaderboardAlerts: true,
      showLeaderboardMetricPlaytime: true,
      showLeaderboardMetricAchievements: true,
      showLeaderboardMetricGames: true,
      showLeaderboardMetricStreak: true,
      showLeaderboardMetricSessions: true,
      showLeaderboardMetricSouvenirs: true,
      showLeaderboardMetricReviews: true,
      showLeaderboardMetricFriends: true,
      showOtherPlayersPlaytime: true,
      showActivePlayerCounts: true,
      showCommunityReviews: true,
      showCommunityStarRatings: true,
      hideCommunityScreenshots: false,
      showFriendsAndChat: true,
      showFriends: true,
      showChatAndMessages: true,
      showNotificationsMenu: true,
      showAccountProfileHeader: true,
    },
  },
} satisfies Record<
  string,
  { title: string; description: string; defaults: Partial<UserPreferences> }
>;

export type PreferenceResetGroup = keyof typeof SETTINGS_RESET_GROUPS;
export type SettingsResetGroup =
  | PreferenceResetGroup
  | "combined"
  | "backups"
  | "gameRules";
export type SettingsResetTarget = {
  group: SettingsResetGroup;
  gameKey?: string;
};
export const COMBINED_RESET_GROUPS: PreferenceResetGroup[] = [
  "general",
  "appearance",
  "notifications",
  "bigPicture",
  "screenshots",
  "websites",
  "downloads",
  "features",
  "dangerZone",
  "protection",
];
export const BACKUP_BEHAVIOR_DEFAULTS = {
  enabled: true,
  fullRetention: 10,
  differentialRetention: 0,
  exitDelaySeconds: 10,
  format: "zip",
  compression: "deflate",
} as const;
export const GAME_RULE_DEFAULTS = {
  enabled: true,
  savePaths: [] as string[],
  trackingPaths: [] as string[],
};

export const resetPreferenceDefaults = (
  group: PreferenceResetGroup | "combined"
): Partial<UserPreferences> =>
  structuredClone(
    group === "combined"
      ? Object.assign(
          {},
          ...COMBINED_RESET_GROUPS.map(
            (id) => SETTINGS_RESET_GROUPS[id].defaults
          )
        )
      : SETTINGS_RESET_GROUPS[group].defaults
  );

// The UI and the reset engine share the same effective installation defaults.
export function withResetDefaults(
  preferences: UserPreferences | null | undefined
): UserPreferences {
  const defaults = structuredClone(
    Object.assign(
      {},
      ...Object.values(SETTINGS_RESET_GROUPS).map((group) => group.defaults)
    )
  );
  const present = Object.fromEntries(
    Object.entries(preferences ?? {}).filter(([, value]) => value !== undefined)
  );
  return {
    ...defaults,
    ...present,
    bigPictureLaunchToLibraryPage:
      preferences?.bigPictureLaunchToLibraryPage ??
      preferences?.launchToLibraryPage ??
      false,
  };
}

export interface SettingsResetChange {
  key: string;
  label: string;
  before: string;
  after: string;
}
export interface SettingsResetRecovery {
  target: SettingsResetTarget;
  savedAt: string;
  interrupted: boolean;
}
export interface SettingsResetPreview {
  token: string;
  target: SettingsResetTarget;
  restoring: boolean;
  expiresAt: number;
  changes: SettingsResetChange[];
  warnings: string[];
  confirmationPhrase: string | null;
  directTorrentConfirmation: boolean;
  retryingInterrupted?: boolean;
}
export interface SettingsResetStatus {
  target: SettingsResetTarget;
  isDefault: boolean;
  recovery: SettingsResetRecovery | null;
  blockedReason?: string;
}
export function resetValuesEqual(a: unknown, b: unknown) {
  return settingsValueEqual(a, b);
}
export function resetFieldLabel(key: string) {
  return key
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/^./, (c) => c.toUpperCase());
}
export function resetDisplayValue(value: unknown): string {
  if (value === undefined || value === null) return "Default / unset";
  if (typeof value === "boolean") return value ? "On" : "Off";
  if (Array.isArray(value))
    return value.length ? value.map(String).join(", ") : "None / automatic";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}
