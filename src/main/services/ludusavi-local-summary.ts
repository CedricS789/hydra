import type {
  LudusaviGameBackupSummary,
  LudusaviLocalResult,
  SaveBackupVersion,
} from "../../types/local-edition.types.js";

const emptySummary = (): LudusaviGameBackupSummary => ({
  lastBackupAt: null,
  lastAttemptAt: null,
  lastAttemptStatus: null,
  lastError: null,
  files: 0,
  bytes: 0,
  registryKeys: 0,
});

/** Updates a game's persisted backup summary from an execution result. */
export const applyLudusaviResultToSummary = (
  existing: LudusaviGameBackupSummary | undefined,
  result: LudusaviLocalResult
): LudusaviGameBackupSummary | null => {
  const operation = result.operation ?? "backup";
  if (operation !== "backup" || result.status === "preview") {
    return null;
  }

  const base = existing ?? emptySummary();
  if (result.status === "success") {
    return {
      lastBackupAt: result.at,
      lastAttemptAt: result.at,
      lastAttemptStatus: "success",
      lastError: null,
      files: result.files,
      bytes: result.bytes,
      registryKeys: result.registryKeys,
    };
  }

  return {
    ...base,
    lastAttemptAt: result.at,
    lastAttemptStatus: "failed",
    lastError: result.message || "Backup failed",
  };
};

/** Backfills a game's lastBackupAt from on-disk versions when newer than stored metadata. */
export const backfillBackupSummaryFromVersions = (
  existing: LudusaviGameBackupSummary | undefined,
  versions: Pick<SaveBackupVersion, "when">[]
): LudusaviGameBackupSummary | null => {
  if (!versions.length) return null;

  let newestIso: string | null = null;
  let newestMs = -Infinity;
  for (const version of versions) {
    const parsed = Date.parse(version.when);
    if (!Number.isFinite(parsed)) continue;
    if (parsed > newestMs) {
      newestMs = parsed;
      newestIso = new Date(parsed).toISOString();
    }
  }
  if (!newestIso) return null;

  const existingMs = existing?.lastBackupAt
    ? Date.parse(existing.lastBackupAt)
    : -Infinity;
  if (Number.isFinite(existingMs) && existingMs >= newestMs) {
    return null;
  }

  const base = existing ?? emptySummary();
  return {
    ...base,
    lastBackupAt: newestIso,
    lastAttemptAt: base.lastAttemptAt ?? newestIso,
    lastAttemptStatus: base.lastAttemptStatus ?? "success",
  };
};

export type BulkBackupOutcomeKind = "succeeded" | "skipped" | "failed";

/** Classifies a single-game backup outcome during a bulk run. */
export const classifyBulkBackupOutcome = (
  result: Pick<LudusaviLocalResult, "status" | "message"> | undefined,
  skipMessages: string[]
): BulkBackupOutcomeKind => {
  if (!result) return "skipped";
  if (result.status === "success") return "succeeded";
  const normalized = result.message.trim().toLowerCase();
  if (
    normalized &&
    skipMessages.some((msg) => msg && normalized.includes(msg.toLowerCase()))
  ) {
    return "skipped";
  }
  return "failed";
};
