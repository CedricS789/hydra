import type { UserPreferences } from "@types";

export const isClassicsEnabled = (
  preferences: Pick<UserPreferences, "enableClassics"> | null | undefined
): boolean => preferences?.enableClassics !== false;

export const isTransferGameEnabled = (
  preferences: Pick<UserPreferences, "enableTransferGame"> | null | undefined
): boolean => preferences?.enableTransferGame !== false;

export const isHydraAchievementPointsEnabled = (
  preferences:
    | Pick<UserPreferences, "showHydraAchievementPoints">
    | null
    | undefined
): boolean => preferences?.showHydraAchievementPoints === true;
