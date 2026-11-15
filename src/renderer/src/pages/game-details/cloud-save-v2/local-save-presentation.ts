import type { LudusaviGameBackupSummary } from "@types";
import type {
  CloudSavePresentationIcon,
  CloudSavePresentationTone,
} from "./cloud-save-presentation";

export type LocalSavePresentationKind =
  | "backing-up"
  | "failed"
  | "backed-up"
  | "disabled"
  | "ready"
  | "no-executable";

export interface LocalSavePresentation {
  kind: LocalSavePresentationKind;
  icon: CloudSavePresentationIcon;
  tone: CloudSavePresentationTone;
  lastBackupAt: string | null;
  lastAttemptAt: string | null;
  lastError: string | null;
  files: number;
  bytes: number;
}

export interface LocalSavePresentationInput {
  globalEnabled: boolean;
  gameEnabled: boolean;
  hasExecutablePath: boolean;
  isBackingUp: boolean;
  summary?: LudusaviGameBackupSummary | null;
}

/**
 * Resolves the compact hero pill state and tone for a game's local Ludusavi backups.
 */
export const getLocalSavePresentation = ({
  globalEnabled,
  gameEnabled,
  hasExecutablePath,
  isBackingUp,
  summary,
}: LocalSavePresentationInput): LocalSavePresentation => {
  const lastBackupAt = summary?.lastBackupAt ?? null;
  const lastAttemptAt = summary?.lastAttemptAt ?? null;
  const lastError = summary?.lastError ?? null;
  const files = summary?.files ?? 0;
  const bytes = summary?.bytes ?? 0;

  if (isBackingUp) {
    return {
      kind: "backing-up",
      icon: "spinner",
      tone: "neutral",
      lastBackupAt,
      lastAttemptAt,
      lastError,
      files,
      bytes,
    };
  }

  if (summary?.lastAttemptStatus === "failed") {
    return {
      kind: "failed",
      icon: "warning",
      tone: "conflict",
      lastBackupAt,
      lastAttemptAt,
      lastError,
      files,
      bytes,
    };
  }

  if (lastBackupAt) {
    return {
      kind: "backed-up",
      icon: "synced",
      tone: "synced",
      lastBackupAt,
      lastAttemptAt,
      lastError,
      files,
      bytes,
    };
  }

  if (!globalEnabled || !gameEnabled) {
    return {
      kind: "disabled",
      icon: "cloud-slash",
      tone: "neutral",
      lastBackupAt: null,
      lastAttemptAt,
      lastError,
      files: 0,
      bytes: 0,
    };
  }

  if (!hasExecutablePath) {
    return {
      kind: "no-executable",
      icon: "cloud",
      tone: "neutral",
      lastBackupAt: null,
      lastAttemptAt,
      lastError,
      files: 0,
      bytes: 0,
    };
  }

  return {
    kind: "ready",
    icon: "cloud",
    tone: "neutral",
    lastBackupAt: null,
    lastAttemptAt,
    lastError,
    files: 0,
    bytes: 0,
  };
};
