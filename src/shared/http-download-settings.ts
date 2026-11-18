import type { UserPreferences } from "../types/level.types";

export const HTTP_DOWNLOAD_BOUNDS = {
  parallelConnections: { min: 1, max: 16, uiMax: 8, defaultValue: 4 },
  rangeSizeMb: { min: 8, max: 256, auto: 0, presets: [0, 8, 32, 64, 128, 256] },
  stallTimeoutSeconds: { min: 10, max: 120, defaultValue: 30 },
  checkpointIntervalSeconds: { min: 1, max: 30, defaultValue: 5 },
  maxRetryAttempts: { min: 3, max: 30, defaultValue: 10 },
} as const;

export const HTTP_DOWNLOAD_DEFAULTS = {
  httpParallelDownloadsEnabled: true,
  httpParallelConnections:
    HTTP_DOWNLOAD_BOUNDS.parallelConnections.defaultValue,
  httpRangeSizeMb: HTTP_DOWNLOAD_BOUNDS.rangeSizeMb.auto,
  httpStallTimeoutSeconds:
    HTTP_DOWNLOAD_BOUNDS.stallTimeoutSeconds.defaultValue,
  httpCheckpointIntervalSeconds:
    HTTP_DOWNLOAD_BOUNDS.checkpointIntervalSeconds.defaultValue,
  httpMaxRetryAttempts: HTTP_DOWNLOAD_BOUNDS.maxRetryAttempts.defaultValue,
} as const satisfies Pick<
  UserPreferences,
  | "httpParallelDownloadsEnabled"
  | "httpParallelConnections"
  | "httpRangeSizeMb"
  | "httpStallTimeoutSeconds"
  | "httpCheckpointIntervalSeconds"
  | "httpMaxRetryAttempts"
>;

export interface ResolvedHttpDownloadSettings {
  parallelDownloadsEnabled: boolean;
  parallelConnections: number;
  rangeSizeBytes: number | null;
  stallTimeoutMs: number;
  checkpointIntervalMs: number;
  maxRetryAttempts: number;
}

const clampInt = (
  value: unknown,
  min: number,
  max: number,
  fallback: number
): number => {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, Math.round(value)));
};

export const normalizeHttpRangeSizeMb = (value: unknown): number => {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return HTTP_DOWNLOAD_DEFAULTS.httpRangeSizeMb;
  }
  const rounded = Math.round(value);
  if (rounded <= 0) return HTTP_DOWNLOAD_BOUNDS.rangeSizeMb.auto;
  return Math.min(
    HTTP_DOWNLOAD_BOUNDS.rangeSizeMb.max,
    Math.max(HTTP_DOWNLOAD_BOUNDS.rangeSizeMb.min, rounded)
  );
};

export const resolveHttpDownloadSettings = (
  preferences?: Partial<UserPreferences> | null
): ResolvedHttpDownloadSettings => {
  const parallelDownloadsEnabled =
    preferences?.httpParallelDownloadsEnabled !== false;
  const parallelConnections = clampInt(
    preferences?.httpParallelConnections,
    HTTP_DOWNLOAD_BOUNDS.parallelConnections.min,
    HTTP_DOWNLOAD_BOUNDS.parallelConnections.max,
    HTTP_DOWNLOAD_DEFAULTS.httpParallelConnections
  );
  const rangeSizeMb = normalizeHttpRangeSizeMb(preferences?.httpRangeSizeMb);
  const stallTimeoutSeconds = clampInt(
    preferences?.httpStallTimeoutSeconds,
    HTTP_DOWNLOAD_BOUNDS.stallTimeoutSeconds.min,
    HTTP_DOWNLOAD_BOUNDS.stallTimeoutSeconds.max,
    HTTP_DOWNLOAD_DEFAULTS.httpStallTimeoutSeconds
  );
  const checkpointIntervalSeconds = clampInt(
    preferences?.httpCheckpointIntervalSeconds,
    HTTP_DOWNLOAD_BOUNDS.checkpointIntervalSeconds.min,
    HTTP_DOWNLOAD_BOUNDS.checkpointIntervalSeconds.max,
    HTTP_DOWNLOAD_DEFAULTS.httpCheckpointIntervalSeconds
  );
  const maxRetryAttempts = clampInt(
    preferences?.httpMaxRetryAttempts,
    HTTP_DOWNLOAD_BOUNDS.maxRetryAttempts.min,
    HTTP_DOWNLOAD_BOUNDS.maxRetryAttempts.max,
    HTTP_DOWNLOAD_DEFAULTS.httpMaxRetryAttempts
  );

  return {
    parallelDownloadsEnabled,
    parallelConnections: parallelDownloadsEnabled ? parallelConnections : 1,
    rangeSizeBytes: rangeSizeMb > 0 ? rangeSizeMb * 1024 * 1024 : null,
    stallTimeoutMs: stallTimeoutSeconds * 1000,
    checkpointIntervalMs: checkpointIntervalSeconds * 1000,
    maxRetryAttempts,
  };
};

export const HTTP_DOWNLOAD_PREFERENCE_KEYS = [
  "httpParallelDownloadsEnabled",
  "httpParallelConnections",
  "httpRangeSizeMb",
  "httpStallTimeoutSeconds",
  "httpCheckpointIntervalSeconds",
  "httpMaxRetryAttempts",
] as const satisfies readonly (keyof UserPreferences)[];
