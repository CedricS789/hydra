import type { GameShop } from "./game.types";

export interface LudusaviGameSettings {
  enabled: boolean;
  savePaths: string[];
  trackingPaths: string[];
  manifestTitle?: string;
  steamId?: string;
}

export interface DetectedSaveGame {
  id: string;
  title: string;
  source: "saves" | "backups";
  files: number;
  registryKeys: number;
  versions: number;
  filePaths: string[];
  steamId?: string;
  matchedShop?: "steam" | "epic" | "launchbox" | "custom";
  matchedObjectId?: string;
  matchedGameKey?: string;
  matchedTitle?: string;
  iconUrl?: string | null;
  coverImageUrl?: string | null;
  libraryHeroImageUrl?: string | null;
  logoImageUrl?: string | null;
  matchingGameKeys: string[];
}

export interface SaveDiscoveryProgress {
  phase: "preparing" | "scanning" | "metadata" | "complete" | "failed";
  completed: number;
  total?: number;
  currentTitles: string[];
}

export interface AddDetectedSaveGameRequest {
  entryId: string;
  targetGameKey?: string;
  executablePath?: string;
}

export interface LudusaviLocalSettings {
  enabled: boolean;
  destination: string;
  fullRetention: number;
  exitDelaySeconds: number;
  games: Record<string, LudusaviGameSettings>;
  differentialRetention?: number;
  format?: "zip" | "simple";
  compression?: "none" | "deflate" | "bzip2" | "zstd";
}

export interface SaveBackupVersion {
  name: string;
  when: string;
  locked: boolean;
  comment?: string | null;
  os?: string | null;
}

export interface SaveSafetySnapshot {
  id: string;
  backup: string;
  when: string;
  files: number;
  hasRegistry: boolean;
  path: string;
}

export interface SaveBackupFile {
  path: string;
  bytes: number;
  change: string;
  ignored: boolean;
  failed: boolean;
}

export interface SaveOperationPreview {
  token: string;
  operation: "restore" | "upload" | "download";
  gameKey: string;
  title: string;
  backup: string;
  snapshotId?: string;
  files: SaveBackupFile[];
  registry: string[];
  expiresAt: number;
}

export interface SaveOperationResult {
  message: string;
  safetyPath?: string;
  safetySnapshotId?: string;
  safetyBackupName?: string;
  files?: number;
  bytes?: number;
  registryKeys?: number;
  filePaths?: string[];
}

export interface LudusaviLocalResult {
  operation?:
    | "backup"
    | "restore"
    | "validate"
    | "upload"
    | "download"
    | "manager";
  gameKey: string;
  title: string;
  at: string;
  status: "success" | "failed" | "preview";
  files: number;
  bytes: number;
  registryKeys: number;
  filePaths: string[];
  message: string;
  cloudSync: "not-verified" | "complete";
}

export interface LudusaviGameBackupSummary {
  lastBackupAt: string | null;
  lastAttemptAt: string | null;
  lastAttemptStatus: "success" | "failed" | null;
  lastError: string | null;
  files: number;
  bytes: number;
  registryKeys: number;
}

export interface LudusaviBulkBackupOutcomeItem {
  gameKey: string;
  title: string;
  reason: string;
}

export interface LudusaviBulkBackupSummary {
  finishedAt: string;
  total: number;
  succeeded: number;
  skipped: number;
  failed: number;
  skippedGames: LudusaviBulkBackupOutcomeItem[];
  failures: LudusaviBulkBackupOutcomeItem[];
  configBackup?: {
    status: "success" | "failed";
    message: string;
  };
}

export interface LudusaviBulkBackupProgress {
  running: boolean;
  total: number;
  completed: number;
  succeeded: number;
  skipped: number;
  failed: number;
  currentGameKey: string | null;
  currentGameTitle: string | null;
  lastSummary: LudusaviBulkBackupSummary | null;
}

export interface LudusaviLocalState {
  settings: LudusaviLocalSettings;
  history: LudusaviLocalResult[];
  gameSummaries: Record<string, LudusaviGameBackupSummary>;
  activeGameKey: string | null;
  bulkProgress: LudusaviBulkBackupProgress;
  busy: boolean;
  logPath: string;
  games: {
    key: string;
    title: string;
    executablePath: string | null;
  }[];
}

export interface LocalRelease {
  tag: string;
  name: string;
  notes: string;
  url: string;
  publishedAt: string;
}

export interface LocalReleaseState {
  version: string;
  sourceRef: string;
  upstreamTag: string;
  custom: LocalRelease[];
  upstream: LocalRelease[];
  preparation?: {
    phase:
      | "current"
      | "available"
      | "preparing"
      | "failed"
      | "disabled"
      | "unknown";
    officialTag: string;
    url: string;
  };
}

export interface ReleaseSourceFile {
  path: string;
  status: "added" | "removed" | "modified";
  originalSha: string | null;
  modifiedSha: string | null;
}

export type LibraryExclusionReason =
  | "removed"
  | "manual"
  | "steam-bulk"
  | "bulk";

export interface ExcludedLibraryGame {
  shop: GameShop;
  objectId: string;
  title: string;
  source?: string | null;
  iconUrl?: string | null;
  libraryImageUrl?: string | null;
  reason?: LibraryExclusionReason;
  excludedAt: number;
}

export interface ExcludedLibraryGameInput {
  shop: GameShop;
  objectId: string;
  title?: string | null;
  source?: string | null;
  iconUrl?: string | null;
  libraryImageUrl?: string | null;
  reason?: LibraryExclusionReason;
  excludedAt?: number;
}
