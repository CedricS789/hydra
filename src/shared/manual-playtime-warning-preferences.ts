import type { UserPreferences } from "@types";

export type ManualPlaytimeWarningPreferenceKey =
  | "showManualPlaytimeWarningIcon"
  | "showManualPlaytimeWarningText";

export interface ManualPlaytimeWarningControlItem {
  key: ManualPlaytimeWarningPreferenceKey;
  label: string;
}

export const MANUAL_PLAYTIME_WARNING_CONTROLS: readonly ManualPlaytimeWarningControlItem[] =
  [
    {
      key: "showManualPlaytimeWarningIcon",
      label: "Show manual playtime warning icon",
    },
    {
      key: "showManualPlaytimeWarningText",
      label: "Show manual playtime warning text and tooltips",
    },
  ];

export interface ResolvedManualPlaytimeWarningPreferences {
  showManualPlaytimeWarningIcon: boolean;
  showManualPlaytimeWarningText: boolean;
}

export type ManualPlaytimeWarningPreferencesInput =
  | Partial<Pick<UserPreferences, ManualPlaytimeWarningPreferenceKey>>
  | null
  | undefined;

export const resolveManualPlaytimeWarningPreferences = (
  preferences: ManualPlaytimeWarningPreferencesInput
): ResolvedManualPlaytimeWarningPreferences => ({
  showManualPlaytimeWarningIcon:
    preferences?.showManualPlaytimeWarningIcon !== false,
  showManualPlaytimeWarningText:
    preferences?.showManualPlaytimeWarningText !== false,
});
