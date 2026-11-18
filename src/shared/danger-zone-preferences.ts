import type { UserPreferences } from "@types";

export type DangerZonePreferenceKey =
  | "enableDangerZone"
  | "enableDangerZoneChangePlaytime"
  | "enableDangerZoneResetPlaytime"
  | "enableDangerZoneResetAchievements"
  | "enableDangerZoneRemoveGameFiles"
  | "enableDangerZoneRemoveFromLibrary"
  | "enableDangerZoneDeleteScreenshots";

export type DangerZoneActionPreferenceKey = Exclude<
  DangerZonePreferenceKey,
  "enableDangerZone"
>;

export interface DangerZoneControlItem<
  TKey extends DangerZonePreferenceKey = DangerZonePreferenceKey,
> {
  key: TKey;
  label: string;
  description?: string;
}

export const DANGER_ZONE_MASTER_CONTROL: DangerZoneControlItem<"enableDangerZone"> =
  {
    key: "enableDangerZone",
    label: "Show Danger Zone tab in title settings",
    description:
      "When turned off, the Danger Zone tab is hidden in every title's settings across Desktop and Big Picture.",
  };

export const DANGER_ZONE_ACTION_CONTROLS: readonly DangerZoneControlItem<DangerZoneActionPreferenceKey>[] =
  [
    {
      key: "enableDangerZoneChangePlaytime",
      label: "Change playtime",
    },
    {
      key: "enableDangerZoneResetPlaytime",
      label: "Reset playtime",
    },
    {
      key: "enableDangerZoneResetAchievements",
      label: "Reset achievements",
    },
    {
      key: "enableDangerZoneRemoveGameFiles",
      label: "Remove game files (Danger Zone & context menus)",
    },
    {
      key: "enableDangerZoneRemoveFromLibrary",
      label: "Remove from library (Danger Zone & context menus)",
    },
    {
      key: "enableDangerZoneDeleteScreenshots",
      label: "Delete screenshots (My Screenshots in Danger Zone)",
    },
  ];

export interface ResolvedDangerZonePreferences {
  enableDangerZone: boolean;
  enableDangerZoneChangePlaytime: boolean;
  enableDangerZoneResetPlaytime: boolean;
  enableDangerZoneResetAchievements: boolean;
  enableDangerZoneRemoveGameFiles: boolean;
  enableDangerZoneRemoveFromLibrary: boolean;
  enableDangerZoneDeleteScreenshots: boolean;
}

export type DangerZonePreferencesInput =
  | Partial<Pick<UserPreferences, DangerZonePreferenceKey>>
  | null
  | undefined;

export const resolveDangerZonePreferences = (
  preferences: DangerZonePreferencesInput
): ResolvedDangerZonePreferences => ({
  enableDangerZone: preferences?.enableDangerZone !== false,
  enableDangerZoneChangePlaytime:
    preferences?.enableDangerZoneChangePlaytime !== false,
  enableDangerZoneResetPlaytime:
    preferences?.enableDangerZoneResetPlaytime !== false,
  enableDangerZoneResetAchievements:
    preferences?.enableDangerZoneResetAchievements !== false,
  enableDangerZoneRemoveGameFiles:
    preferences?.enableDangerZoneRemoveGameFiles !== false,
  enableDangerZoneRemoveFromLibrary:
    preferences?.enableDangerZoneRemoveFromLibrary !== false,
  enableDangerZoneDeleteScreenshots:
    preferences?.enableDangerZoneDeleteScreenshots !== false,
});

export interface DangerZoneVisibilityOptions {
  isCustomGame?: boolean;
  screenshotsFeatureEnabled?: boolean;
  includePlaytimeActions?: boolean;
}

export const hasAnyDangerZoneActionEnabled = (
  resolved: ResolvedDangerZonePreferences,
  options: DangerZoneVisibilityOptions = {}
): boolean => {
  const {
    isCustomGame = false,
    screenshotsFeatureEnabled = true,
    includePlaytimeActions = true,
  } = options;

  if (
    includePlaytimeActions &&
    (resolved.enableDangerZoneChangePlaytime ||
      resolved.enableDangerZoneResetPlaytime)
  ) {
    return true;
  }

  if (resolved.enableDangerZoneRemoveFromLibrary) {
    return true;
  }

  if (
    !isCustomGame &&
    (resolved.enableDangerZoneResetAchievements ||
      resolved.enableDangerZoneRemoveGameFiles)
  ) {
    return true;
  }

  if (screenshotsFeatureEnabled && resolved.enableDangerZoneDeleteScreenshots) {
    return true;
  }

  return false;
};

export const isDangerZoneTabVisible = (
  preferences: DangerZonePreferencesInput,
  options: DangerZoneVisibilityOptions = {}
): boolean => {
  const resolved = resolveDangerZonePreferences(preferences);
  return (
    resolved.enableDangerZone &&
    hasAnyDangerZoneActionEnabled(resolved, options)
  );
};

export const buildDisableAllDangerZonePreferencesPatch =
  (): ResolvedDangerZonePreferences => ({
    enableDangerZone: false,
    enableDangerZoneChangePlaytime: false,
    enableDangerZoneResetPlaytime: false,
    enableDangerZoneResetAchievements: false,
    enableDangerZoneRemoveGameFiles: false,
    enableDangerZoneRemoveFromLibrary: false,
    enableDangerZoneDeleteScreenshots: false,
  });

export const buildEnableAllDangerZonePreferencesPatch =
  (): ResolvedDangerZonePreferences => ({
    enableDangerZone: true,
    enableDangerZoneChangePlaytime: true,
    enableDangerZoneResetPlaytime: true,
    enableDangerZoneResetAchievements: true,
    enableDangerZoneRemoveGameFiles: true,
    enableDangerZoneRemoveFromLibrary: true,
    enableDangerZoneDeleteScreenshots: true,
  });

export const areAllDangerZonePreferencesDisabled = (
  resolved: ResolvedDangerZonePreferences
): boolean =>
  !resolved.enableDangerZone &&
  !resolved.enableDangerZoneChangePlaytime &&
  !resolved.enableDangerZoneResetPlaytime &&
  !resolved.enableDangerZoneResetAchievements &&
  !resolved.enableDangerZoneRemoveGameFiles &&
  !resolved.enableDangerZoneRemoveFromLibrary &&
  !resolved.enableDangerZoneDeleteScreenshots;

export const areAllDangerZonePreferencesEnabled = (
  resolved: ResolvedDangerZonePreferences
): boolean =>
  resolved.enableDangerZone &&
  resolved.enableDangerZoneChangePlaytime &&
  resolved.enableDangerZoneResetPlaytime &&
  resolved.enableDangerZoneResetAchievements &&
  resolved.enableDangerZoneRemoveGameFiles &&
  resolved.enableDangerZoneRemoveFromLibrary &&
  resolved.enableDangerZoneDeleteScreenshots;
