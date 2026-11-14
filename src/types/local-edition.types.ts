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
}

export interface LudusaviLocalResult {
  gameKey: string;
  title: string;
  at: string;
  status: "success" | "failed" | "preview";
  files: number;
  bytes: number;
  registryKeys: number;
  filePaths: string[];
  message: string;
  cloudSync: "not-verified";
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
