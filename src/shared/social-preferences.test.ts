import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  areAllSocialPreferencesDisabled,
  areSocialPreferencesDefault,
  buildDisableAllSocialPreferencesPatch,
  buildRestoreSocialDefaultsPatch,
  buildSocialPreferenceUpdatePatch,
  hasAnyEnabledLeaderboardMetric,
  isLeaderboardMetricVisible,
  resolveSocialPreferences,
} from "./social-preferences.js";

describe("social-preferences", () => {
  it("defaults all social features to visible when preferences are empty", () => {
    const resolved = resolveSocialPreferences(null);

    assert.equal(resolved.showLeaderboardsAndRankings, true);
    assert.equal(resolved.showGlobalLeaderboards, true);
    assert.equal(resolved.showGameRankingCard, true);
    assert.equal(resolved.showLeaderboardAlerts, true);
    assert.equal(resolved.showLeaderboardMetricPlaytime, true);
    assert.equal(resolved.showLeaderboardMetricAchievements, true);
    assert.equal(resolved.showLeaderboardMetricGames, true);
    assert.equal(resolved.showLeaderboardMetricStreak, true);
    assert.equal(resolved.showLeaderboardMetricSessions, true);
    assert.equal(resolved.showLeaderboardMetricSouvenirs, true);
    assert.equal(resolved.showLeaderboardMetricReviews, true);
    assert.equal(resolved.showLeaderboardMetricFriends, true);
    assert.equal(resolved.showOtherPlayersPlaytime, true);
    assert.equal(resolved.showActivePlayerCounts, true);
    assert.equal(resolved.showCommunityReviews, true);
    assert.equal(resolved.showCommunityStarRatings, true);
    assert.equal(resolved.showCommunityScreenshots, true);
    assert.equal(resolved.showFriendsAndChat, true);
    assert.equal(resolved.showFriends, true);
    assert.equal(resolved.showChatAndMessages, true);
    assert.equal(resolved.showNotificationsMenu, true);
    assert.equal(resolved.showAccountProfileHeader, true);
    assert.equal(areSocialPreferencesDefault(resolved), true);
    assert.equal(areAllSocialPreferencesDisabled(resolved), false);
    assert.equal(hasAnyEnabledLeaderboardMetric(resolved), true);
  });

  it("maps hideCommunityScreenshots inversely to showCommunityScreenshots", () => {
    const resolved = resolveSocialPreferences({
      hideCommunityScreenshots: true,
      showLeaderboardsAndRankings: false,
    });

    assert.equal(resolved.showCommunityScreenshots, false);
    assert.equal(resolved.showLeaderboardsAndRankings, false);
    assert.equal(resolved.showGlobalLeaderboards, false);
    assert.equal(resolved.showGameRankingCard, false);
    assert.equal(resolved.showLeaderboardAlerts, false);
    assert.equal(resolved.showOtherPlayersPlaytime, true);
    assert.equal(areSocialPreferencesDefault(resolved), false);
  });

  it("inherits legacy parent flags while allowing granular overrides", () => {
    const legacyDisabled = resolveSocialPreferences({
      showLeaderboardsAndRankings: false,
      showOtherPlayersPlaytime: false,
      showCommunityReviews: false,
      showFriendsAndChat: false,
    });

    assert.equal(legacyDisabled.showGlobalLeaderboards, false);
    assert.equal(legacyDisabled.showGameRankingCard, false);
    assert.equal(legacyDisabled.showLeaderboardAlerts, false);
    assert.equal(legacyDisabled.showActivePlayerCounts, false);
    assert.equal(legacyDisabled.showCommunityStarRatings, false);
    assert.equal(legacyDisabled.showFriends, false);
    assert.equal(legacyDisabled.showChatAndMessages, false);
    assert.equal(legacyDisabled.showNotificationsMenu, true);

    const overridden = resolveSocialPreferences({
      showLeaderboardsAndRankings: false,
      showGameRankingCard: true,
      showOtherPlayersPlaytime: false,
      showActivePlayerCounts: true,
      showCommunityReviews: false,
      showCommunityStarRatings: true,
      showFriendsAndChat: false,
      showFriends: true,
    });

    assert.equal(overridden.showGlobalLeaderboards, false);
    assert.equal(overridden.showGameRankingCard, true);
    assert.equal(overridden.showLeaderboardAlerts, false);
    assert.equal(overridden.showLeaderboardsAndRankings, true);
    assert.equal(overridden.showOtherPlayersPlaytime, false);
    assert.equal(overridden.showActivePlayerCounts, true);
    assert.equal(overridden.showCommunityReviews, false);
    assert.equal(overridden.showCommunityStarRatings, true);
    assert.equal(overridden.showFriends, true);
    assert.equal(overridden.showChatAndMessages, false);
    assert.equal(overridden.showFriendsAndChat, true);
  });

  it("filters leaderboard metrics independently and respects friends visibility", () => {
    const withoutPlaytime = resolveSocialPreferences({
      showLeaderboardMetricPlaytime: false,
    });

    assert.equal(
      isLeaderboardMetricVisible(withoutPlaytime, "playtime"),
      false
    );
    assert.equal(
      isLeaderboardMetricVisible(withoutPlaytime, "achievements"),
      true
    );
    assert.equal(isLeaderboardMetricVisible(withoutPlaytime, "streak"), true);
    assert.equal(
      isLeaderboardMetricVisible(withoutPlaytime, "unknown_future"),
      true
    );
    assert.equal(hasAnyEnabledLeaderboardMetric(withoutPlaytime), true);

    const withoutFriends = resolveSocialPreferences({
      showFriends: false,
      showLeaderboardMetricFriends: true,
    });
    assert.equal(isLeaderboardMetricVisible(withoutFriends, "friends"), false);

    const allMetricsOff = resolveSocialPreferences({
      showLeaderboardMetricPlaytime: false,
      showLeaderboardMetricAchievements: false,
      showLeaderboardMetricGames: false,
      showLeaderboardMetricStreak: false,
      showLeaderboardMetricSessions: false,
      showLeaderboardMetricSouvenirs: false,
      showLeaderboardMetricReviews: false,
      showLeaderboardMetricFriends: false,
    });
    assert.equal(hasAnyEnabledLeaderboardMetric(allMetricsOff), false);
  });

  it("produces patches that disable or restore all social features cleanly", () => {
    const disabledPatch = buildDisableAllSocialPreferencesPatch();
    const disabledResolved = resolveSocialPreferences(disabledPatch);
    assert.equal(areAllSocialPreferencesDisabled(disabledResolved), true);
    assert.equal(areSocialPreferencesDefault(disabledResolved), false);
    // Notifications menu stays available for non-social alerts unless disabled explicitly.
    assert.equal(disabledResolved.showNotificationsMenu, true);

    const restoredPatch = buildRestoreSocialDefaultsPatch();
    const restoredResolved = resolveSocialPreferences(restoredPatch);
    assert.equal(areSocialPreferencesDefault(restoredResolved), true);
    assert.equal(areAllSocialPreferencesDisabled(restoredResolved), false);
  });

  it("builds granular update patches that sync legacy parent flags cleanly", () => {
    const patch = buildSocialPreferenceUpdatePatch(
      { showLeaderboardsAndRankings: false, showFriendsAndChat: false },
      { showGameRankingCard: true }
    );
    assert.equal(patch.showGlobalLeaderboards, false);
    assert.equal(patch.showGameRankingCard, true);
    assert.equal(patch.showLeaderboardAlerts, false);
    assert.equal(patch.showLeaderboardsAndRankings, true);

    const friendsPatch = buildSocialPreferenceUpdatePatch(
      { showFriendsAndChat: false },
      { showFriends: true }
    );
    assert.equal(friendsPatch.showFriends, true);
    assert.equal(friendsPatch.showChatAndMessages, false);
    assert.equal(friendsPatch.showFriendsAndChat, true);

    const screenshotPatch = buildSocialPreferenceUpdatePatch(null, {
      showCommunityScreenshots: false,
    });
    assert.equal(screenshotPatch.hideCommunityScreenshots, true);
  });
});
