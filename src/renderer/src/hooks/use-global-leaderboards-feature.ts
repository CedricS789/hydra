import { resolveSocialPreferences } from "@shared";
import { useAppSelector } from "./redux";
import { useFeature } from "./use-feature";

export function useGlobalLeaderboardsFeature() {
  const { isFeatureEnabled, isFeaturesLoaded, Feature } = useFeature();
  const userPreferences = useAppSelector(
    (state) => state.userPreferences.value
  );
  const social = resolveSocialPreferences(userPreferences);
  const featureFlagEnabled = isFeatureEnabled(Feature.GlobalLeaderboards);

  return {
    isEnabled: featureFlagEnabled && social.showGlobalLeaderboards,
    isGameRankingEnabled: featureFlagEnabled && social.showGameRankingCard,
    isNotificationsGroupEnabled:
      featureFlagEnabled &&
      (social.showGlobalLeaderboards ||
        social.showGameRankingCard ||
        social.showLeaderboardAlerts),
    isLoaded: isFeaturesLoaded,
  };
}
