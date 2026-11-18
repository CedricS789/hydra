import type { UserPreferences } from "../types/level.types";
import type {
  SaveBackupVersion,
  SaveOperationPreview,
  SaveSafetySnapshot,
} from "../types/local-edition.types";

export const HYDRA_CONFIG_BACKUP_ENTRY = "Hydra Ludusavi Config";
export const HYDRA_CONFIG_SNAPSHOT_SCHEMA = 1;
export const HYDRA_CONFIG_RESTORE_CONFIRMATION = "RESTORE CONFIG";
export const HYDRA_CONFIG_MAX_ASSET_BYTES = 10 * 1024 * 1024;
export const HYDRA_CONFIG_MAX_TOTAL_SNAPSHOT_BYTES = 64 * 1024 * 1024;

export const HYDRA_CONFIG_SECRET_PREFERENCE_KEYS = [
  "realDebridApiToken",
  "premiumizeApiToken",
  "allDebridApiToken",
  "torBoxApiToken",
  "retroAchievementsWebApiKey",
  "ggDealsApiKey",
] as const satisfies readonly (keyof UserPreferences)[];

export type HydraConfigSecretPreferenceKey =
  (typeof HYDRA_CONFIG_SECRET_PREFERENCE_KEYS)[number];

export type HydraConfigSectionId =
  | "preferences"
  | "ludusavi"
  | "downloadSources"
  | "emulators"
  | "themes"
  | "sourceProfiles"
  | "library";

export interface HydraConfigSectionDescriptor {
  id: HydraConfigSectionId;
  label: string;
  description: string;
}

export const HYDRA_CONFIG_SECTIONS: readonly HydraConfigSectionDescriptor[] = [
  {
    id: "preferences",
    label: "App preferences & language",
    description:
      "General behavior, downloads, notifications, screenshots, Big Picture, compatibility, companion apps, and social visibility. API tokens are excluded.",
  },
  {
    id: "ludusavi",
    label: "Save backup rules & advanced YAML",
    description:
      "Save backup destination, retention, compression, exit delay, per-game custom paths/matching, and Ludusavi advanced.yaml.",
  },
  {
    id: "downloadSources",
    label: "Download sources",
    description: "Configured download source feeds and metadata.",
  },
  {
    id: "emulators",
    label: "Emulators & RetroArch",
    description:
      "Emulator executables, BIOS paths, ROM folders, RetroArch cores/paths, and emulator cloud-save destinations.",
  },
  {
    id: "themes",
    label: "Themes & custom sounds",
    description: "Custom CSS themes, active theme selection, and sound assets.",
  },
  {
    id: "sourceProfiles",
    label: "Source website profiles",
    description:
      "Website search URLs and approved domains. Browser cookies and sessions are excluded.",
  },
  {
    id: "library",
    label: "Library & per-game settings",
    description:
      "Library games, custom executables, launch options, collections, excluded games, and cloud-save custom paths.",
  },
] as const;

export const ALL_HYDRA_CONFIG_SECTION_IDS: HydraConfigSectionId[] =
  HYDRA_CONFIG_SECTIONS.map((section) => section.id);

export const HYDRA_CONFIG_EXCLUDED_ITEMS: readonly string[] = [
  "Hydra account login tokens (auth), RPC password, and Epic/browser cookies",
  "Debrid, RetroAchievements, and GG.deals API keys (preserved locally on restore)",
  "Catalogue/shop caches, active downloads, logs, and image caches",
];

export interface HydraConfigPathWarning {
  section: HydraConfigSectionId;
  label: string;
  path: string;
  reason: "missing" | "different-platform";
}

export interface HydraConfigSectionDiff {
  id: HydraConfigSectionId;
  label: string;
  available: boolean;
  hasChanges: boolean;
  currentCount: number;
  snapshotCount: number;
  summary: string;
  details: string[];
}

export interface HydraConfigRestorePreview {
  token: string;
  operation: "restore";
  backup: string;
  snapshotId?: string;
  expiresAt: number;
  schemaVersion: number;
  exportedAt: string;
  sourceHostname: string;
  sourcePlatform: string;
  sourceAppVersion: string;
  destinationDiffers: boolean;
  currentDestination: string;
  snapshotDestination: string | null;
  directTorrentConfirmation: boolean;
  confirmationPhrase: string;
  sections: HydraConfigSectionDiff[];
  pathWarnings: HydraConfigPathWarning[];
}

export interface HydraConfigRestoreSelection {
  sections: HydraConfigSectionId[];
  overwriteDestination: boolean;
}

export interface HydraConfigRestoreRequest {
  token: string;
  acknowledged: boolean;
  phrase: string;
  selection: HydraConfigRestoreSelection;
  torrentConfirmation?: string;
}

export interface HydraConfigRestoreResult {
  message: string;
  appliedSections: HydraConfigSectionId[];
  safetySnapshotId?: string;
  safetyBackupName?: string;
  safetyPath?: string;
  destinationPreserved: boolean;
}

export interface HydraConfigBackupResult {
  status: "success" | "preview";
  at: string;
  files: number;
  bytes: number;
  message: string;
  snapshotDir: string;
}

export interface HydraConfigBackupRecord {
  lastBackupAt: string | null;
  lastBackupStatus: "success" | "failed" | null;
  lastBackupMessage: string | null;
}

export interface HydraConfigBackupState {
  entryName: string;
  snapshotDir: string;
  destination: string;
  lastBackup: HydraConfigBackupRecord;
  versions: SaveBackupVersion[];
  safetySnapshots: SaveSafetySnapshot[];
  excludedItems: readonly string[];
}

export type HydraConfigCloudPreview = SaveOperationPreview;

export function stripSecretUserPreferences(
  preferences: UserPreferences | null | undefined
): UserPreferences {
  const cleaned: UserPreferences = { ...(preferences ?? {}) };
  for (const key of HYDRA_CONFIG_SECRET_PREFERENCE_KEYS) {
    delete cleaned[key];
  }
  return cleaned;
}

export function mergePreservedSecretUserPreferences(
  incoming: UserPreferences,
  current: UserPreferences | null | undefined
): UserPreferences {
  const merged = stripSecretUserPreferences(incoming);
  if (!current) return merged;
  for (const key of HYDRA_CONFIG_SECRET_PREFERENCE_KEYS) {
    const value = current[key];
    if (value !== undefined) {
      merged[key] = value;
    }
  }
  return merged;
}
