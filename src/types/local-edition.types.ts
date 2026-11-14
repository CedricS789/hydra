export interface LudusaviGameSettings {
  enabled: boolean;
  savePaths: string[];
  trackingPaths: string[];
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
  files: SaveBackupFile[];
  registry: string[];
  expiresAt: number;
}

export interface SaveOperationResult {
  message: string;
  safetyPath?: string;
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

export interface LudusaviLocalState {
  settings: LudusaviLocalSettings;
  history: LudusaviLocalResult[];
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
}

export interface ReleaseSourceFile {
  path: string;
  status: "added" | "removed" | "modified";
  originalSha: string | null;
  modifiedSha: string | null;
}
