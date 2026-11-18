import type { UserPreferences } from "@types";

export const LEADERBOARD_METRIC_PREFERENCE_KEYS = {
  playtime: "showLeaderboardMetricPlaytime",
  achievements: "showLeaderboardMetricAchievements",
  games: "showLeaderboardMetricGames",
  streak: "showLeaderboardMetricStreak",
  sessions: "showLeaderboardMetricSessions",
  souvenirs: "showLeaderboardMetricSouvenirs",
  reviews: "showLeaderboardMetricReviews",
  friends: "showLeaderboardMetricFriends",
} as const;

export type KnownLeaderboardMetricId =
  keyof typeof LEADERBOARD_METRIC_PREFERENCE_KEYS;

export type LeaderboardMetricPreferenceKey =
  (typeof LEADERBOARD_METRIC_PREFERENCE_KEYS)[KnownLeaderboardMetricId];

export interface SocialPreferenceControlItem {
  key: keyof ResolvedSocialPreferences;
  label: string;
}

export const SOCIAL_LEADERBOARD_SURFACE_CONTROLS: readonly SocialPreferenceControlItem[] =
  [
    {
      key: "showGlobalLeaderboards",
      label: "Show global Leaderboards page & sidebar link",
    },
    {
      key: "showGameRankingCard",
      label: "Show ranking card on game pages",
    },
    {
      key: "showLeaderboardAlerts",
      label: "Show leaderboard rank-change alerts",
    },
  ];

export const SOCIAL_LEADERBOARD_METRIC_CONTROLS: readonly (SocialPreferenceControlItem & {
  id: KnownLeaderboardMetricId;
})[] = [
  { id: "playtime", key: "showLeaderboardMetricPlaytime", label: "Playtime" },
  {
    id: "achievements",
    key: "showLeaderboardMetricAchievements",
    label: "Achievements (Trophies)",
  },
  { id: "games", key: "showLeaderboardMetricGames", label: "Games" },
  { id: "streak", key: "showLeaderboardMetricStreak", label: "Streak" },
  { id: "sessions", key: "showLeaderboardMetricSessions", label: "Sessions" },
  {
    id: "souvenirs",
    key: "showLeaderboardMetricSouvenirs",
    label: "Souvenirs",
  },
  { id: "reviews", key: "showLeaderboardMetricReviews", label: "Reviews" },
  { id: "friends", key: "showLeaderboardMetricFriends", label: "Friends" },
];

export const SOCIAL_COMMUNITY_CONTROLS: readonly SocialPreferenceControlItem[] =
  [
    {
      key: "showOtherPlayersPlaytime",
      label: "Show other players' playtime (profiles & reviews)",
    },
    {
      key: "showActivePlayerCounts",
      label: 'Show active player counts ("Playing now")',
    },
    {
      key: "showCommunityReviews",
      label: "Show community reviews & review prompts",
    },
    {
      key: "showCommunityStarRatings",
      label: "Show community star ratings (average score)",
    },
    {
      key: "showCommunityScreenshots",
      label: "Show community screenshots",
    },
  ];

export const SOCIAL_NAVIGATION_CONTROLS: readonly SocialPreferenceControlItem[] =
  [
    {
      key: "showFriends",
      label: "Show friends & friend activity",
    },
    {
      key: "showChatAndMessages",
      label: "Show direct chat & unread message badges",
    },
    {
      key: "showNotificationsMenu",
      label: "Show notifications menu in sidebar",
    },
    {
      key: "showAccountProfileHeader",
      label: "Show account & profile header in sidebar",
    },
  ];

export interface ResolvedSocialPreferences {
  // Legacy summary flags kept for backward compatibility with existing consumers/tests
  showLeaderboardsAndRankings: boolean;
  showFriendsAndChat: boolean;

  // Leaderboard surfaces
  showGlobalLeaderboards: boolean;
  showGameRankingCard: boolean;
  showLeaderboardAlerts: boolean;

  // Leaderboard categories / metrics
  showLeaderboardMetricPlaytime: boolean;
  showLeaderboardMetricAchievements: boolean;
  showLeaderboardMetricGames: boolean;
  showLeaderboardMetricStreak: boolean;
  showLeaderboardMetricSessions: boolean;
  showLeaderboardMetricSouvenirs: boolean;
  showLeaderboardMetricReviews: boolean;
  showLeaderboardMetricFriends: boolean;

  // Game & profile community stats
  showOtherPlayersPlaytime: boolean;
  showActivePlayerCounts: boolean;
  showCommunityReviews: boolean;
  showCommunityStarRatings: boolean;
  showCommunityScreenshots: boolean;

  // Friends, chat & sidebar navigation
  showFriends: boolean;
  showChatAndMessages: boolean;
  showNotificationsMenu: boolean;
  showAccountProfileHeader: boolean;
}

export const resolveSocialPreferences = (
  preferences: Partial<UserPreferences> | null | undefined
): ResolvedSocialPreferences => {
  const legacyLeaderboards = preferences?.showLeaderboardsAndRankings !== false;
  const legacyPlaytime = preferences?.showOtherPlayersPlaytime !== false;
  const legacyReviews = preferences?.showCommunityReviews !== false;
  const legacyFriendsChat = preferences?.showFriendsAndChat !== false;

  const showGlobalLeaderboards =
    preferences?.showGlobalLeaderboards ?? legacyLeaderboards;
  const showGameRankingCard =
    preferences?.showGameRankingCard ?? legacyLeaderboards;
  const showLeaderboardAlerts =
    preferences?.showLeaderboardAlerts ?? legacyLeaderboards;

  const showFriends = preferences?.showFriends ?? legacyFriendsChat;
  const showChatAndMessages =
    preferences?.showChatAndMessages ?? legacyFriendsChat;

  return {
    showLeaderboardsAndRankings:
      showGlobalLeaderboards || showGameRankingCard || showLeaderboardAlerts,
    showGlobalLeaderboards,
    showGameRankingCard,
    showLeaderboardAlerts,

    showLeaderboardMetricPlaytime:
      preferences?.showLeaderboardMetricPlaytime !== false,
    showLeaderboardMetricAchievements:
      preferences?.showLeaderboardMetricAchievements !== false,
    showLeaderboardMetricGames:
      preferences?.showLeaderboardMetricGames !== false,
    showLeaderboardMetricStreak:
      preferences?.showLeaderboardMetricStreak !== false,
    showLeaderboardMetricSessions:
      preferences?.showLeaderboardMetricSessions !== false,
    showLeaderboardMetricSouvenirs:
      preferences?.showLeaderboardMetricSouvenirs !== false,
    showLeaderboardMetricReviews:
      preferences?.showLeaderboardMetricReviews !== false,
    showLeaderboardMetricFriends:
      preferences?.showLeaderboardMetricFriends !== false,

    showOtherPlayersPlaytime: legacyPlaytime,
    showActivePlayerCounts:
      preferences?.showActivePlayerCounts ?? legacyPlaytime,
    showCommunityReviews: legacyReviews,
    showCommunityStarRatings:
      preferences?.showCommunityStarRatings ?? legacyReviews,
    showCommunityScreenshots: preferences?.hideCommunityScreenshots !== true,

    showFriendsAndChat: showFriends || showChatAndMessages,
    showFriends,
    showChatAndMessages,
    showNotificationsMenu: preferences?.showNotificationsMenu !== false,
    showAccountProfileHeader: preferences?.showAccountProfileHeader !== false,
  };
};

export const isLeaderboardMetricVisible = (
  social: ResolvedSocialPreferences,
  metricId: string
): boolean => {
  if (metricId === "friends" && !social.showFriends) {
    return false;
  }

  if (Object.hasOwn(LEADERBOARD_METRIC_PREFERENCE_KEYS, metricId)) {
    const key =
      LEADERBOARD_METRIC_PREFERENCE_KEYS[metricId as KnownLeaderboardMetricId];
    return social[key];
  }

  return true;
};

export const hasAnyEnabledLeaderboardMetric = (
  social: ResolvedSocialPreferences
): boolean =>
  (
    Object.keys(
      LEADERBOARD_METRIC_PREFERENCE_KEYS
    ) as KnownLeaderboardMetricId[]
  ).some((metricId) => isLeaderboardMetricVisible(social, metricId));

export const buildSocialPreferenceUpdatePatch = (
  currentPreferences: Partial<UserPreferences> | null | undefined,
  changes: Partial<ResolvedSocialPreferences>
): Partial<UserPreferences> => {
  const mappedChanges: Partial<UserPreferences> = {};

  for (const [key, value] of Object.entries(changes)) {
    if (key === "showCommunityScreenshots") {
      mappedChanges.hideCommunityScreenshots = !value;
    } else {
      (mappedChanges as Record<string, unknown>)[key] = value;
    }
  }

  const nextResolved = resolveSocialPreferences({
    ...currentPreferences,
    ...mappedChanges,
  });

  if (
    Object.hasOwn(changes, "showGlobalLeaderboards") ||
    Object.hasOwn(changes, "showGameRankingCard") ||
    Object.hasOwn(changes, "showLeaderboardAlerts")
  ) {
    mappedChanges.showGlobalLeaderboards = nextResolved.showGlobalLeaderboards;
    mappedChanges.showGameRankingCard = nextResolved.showGameRankingCard;
    mappedChanges.showLeaderboardAlerts = nextResolved.showLeaderboardAlerts;
    mappedChanges.showLeaderboardsAndRankings =
      nextResolved.showLeaderboardsAndRankings;
  }

  if (
    Object.hasOwn(changes, "showOtherPlayersPlaytime") ||
    Object.hasOwn(changes, "showActivePlayerCounts")
  ) {
    mappedChanges.showOtherPlayersPlaytime =
      nextResolved.showOtherPlayersPlaytime;
    mappedChanges.showActivePlayerCounts = nextResolved.showActivePlayerCounts;
  }

  if (
    Object.hasOwn(changes, "showCommunityReviews") ||
    Object.hasOwn(changes, "showCommunityStarRatings")
  ) {
    mappedChanges.showCommunityReviews = nextResolved.showCommunityReviews;
    mappedChanges.showCommunityStarRatings =
      nextResolved.showCommunityStarRatings;
  }

  if (
    Object.hasOwn(changes, "showFriends") ||
    Object.hasOwn(changes, "showChatAndMessages")
  ) {
    mappedChanges.showFriends = nextResolved.showFriends;
    mappedChanges.showChatAndMessages = nextResolved.showChatAndMessages;
    mappedChanges.showFriendsAndChat = nextResolved.showFriendsAndChat;
  }

  return mappedChanges;
};

export const buildDisableAllSocialPreferencesPatch =
  (): Partial<UserPreferences> => ({
    showLeaderboardsAndRankings: false,
    showGlobalLeaderboards: false,
    showGameRankingCard: false,
    showLeaderboardAlerts: false,
    showLeaderboardMetricPlaytime: false,
    showLeaderboardMetricAchievements: false,
    showLeaderboardMetricGames: false,
    showLeaderboardMetricStreak: false,
    showLeaderboardMetricSessions: false,
    showLeaderboardMetricSouvenirs: false,
    showLeaderboardMetricReviews: false,
    showLeaderboardMetricFriends: false,
    showOtherPlayersPlaytime: false,
    showActivePlayerCounts: false,
    showCommunityReviews: false,
    showCommunityStarRatings: false,
    hideCommunityScreenshots: true,
    showFriendsAndChat: false,
    showFriends: false,
    showChatAndMessages: false,
    showAccountProfileHeader: false,
  });

export const buildRestoreSocialDefaultsPatch =
  (): Partial<UserPreferences> => ({
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
  });

export const areAllSocialPreferencesDisabled = (
  social: ResolvedSocialPreferences
): boolean =>
  !social.showGlobalLeaderboards &&
  !social.showGameRankingCard &&
  !social.showLeaderboardAlerts &&
  !social.showLeaderboardMetricPlaytime &&
  !social.showLeaderboardMetricAchievements &&
  !social.showLeaderboardMetricGames &&
  !social.showLeaderboardMetricStreak &&
  !social.showLeaderboardMetricSessions &&
  !social.showLeaderboardMetricSouvenirs &&
  !social.showLeaderboardMetricReviews &&
  !social.showLeaderboardMetricFriends &&
  !social.showOtherPlayersPlaytime &&
  !social.showActivePlayerCounts &&
  !social.showCommunityReviews &&
  !social.showCommunityStarRatings &&
  !social.showCommunityScreenshots &&
  !social.showFriends &&
  !social.showChatAndMessages &&
  !social.showAccountProfileHeader;

export const areSocialPreferencesDefault = (
  social: ResolvedSocialPreferences
): boolean =>
  social.showGlobalLeaderboards &&
  social.showGameRankingCard &&
  social.showLeaderboardAlerts &&
  social.showLeaderboardMetricPlaytime &&
  social.showLeaderboardMetricAchievements &&
  social.showLeaderboardMetricGames &&
  social.showLeaderboardMetricStreak &&
  social.showLeaderboardMetricSessions &&
  social.showLeaderboardMetricSouvenirs &&
  social.showLeaderboardMetricReviews &&
  social.showLeaderboardMetricFriends &&
  social.showOtherPlayersPlaytime &&
  social.showActivePlayerCounts &&
  social.showCommunityReviews &&
  social.showCommunityStarRatings &&
  social.showCommunityScreenshots &&
  social.showFriends &&
  social.showChatAndMessages &&
  social.showNotificationsMenu &&
  social.showAccountProfileHeader;
