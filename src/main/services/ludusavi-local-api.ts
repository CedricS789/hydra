import { createHash, randomUUID } from "node:crypto";
import type {
  SaveBackupFile,
  SaveOperationPreview,
} from "../../types/local-edition.types";

export interface SaveApiResponse {
  errors?: Record<string, unknown>;
  overall?: { processedBytes?: number };
  games?: Record<
    string,
    {
      decision?: string;
      files?: Record<
        string,
        {
          bytes?: number;
          change?: string;
          ignored?: boolean;
          failed?: boolean;
          error?: unknown;
        }
      >;
      registry?: Record<
        string,
        { ignored?: boolean; failed?: boolean; error?: unknown }
      >;
      backups?: import("../../types/local-edition.types").SaveBackupVersion[];
      backupPath?: string;
    }
  >;
  changes?: Record<string, { change?: string }>;
  cloud?: Record<string, { change?: string }>;
}

export function assertSaveApiSuccess(data: SaveApiResponse) {
  if (data.errors && Object.keys(data.errors).length)
    throw new Error(
      "The save operation reported errors. No success has been recorded."
    );
  for (const game of Object.values(data.games ?? {})) {
    if (game.decision && game.decision !== "Processed")
      throw new Error(
        "The selected game was not processed. Check exclusions and game rules."
      );
    if (
      [
        ...Object.values(game.files ?? {}),
        ...Object.values(game.registry ?? {}),
      ].some((item) => item.failed || item.error)
    )
      throw new Error(
        "Some save data could not be processed. Check the operation details."
      );
  }
}

export function savePreviewFiles(
  data: SaveApiResponse,
  title: string
): SaveBackupFile[] {
  return Object.entries(data.games?.[title]?.files ?? {}).map(
    ([file, item]) => ({
      path: file,
      bytes: item.bytes ?? 0,
      change: item.change ?? "Unknown",
      ignored: !!item.ignored,
      failed: !!item.failed || !!item.error,
    })
  );
}

/** Single-use approvals bind the exact preview and current settings, for 5 minutes. */
export class SaveOperationApprovals {
  private pending = new Map<
    string,
    { preview: SaveOperationPreview; fingerprint: string }
  >();
  fingerprint(value: unknown) {
    return createHash("sha256").update(JSON.stringify(value)).digest("hex");
  }
  issue(
    preview: Omit<SaveOperationPreview, "token" | "expiresAt">,
    context: unknown,
    now = Date.now()
  ) {
    for (const [token, item] of this.pending)
      if (item.preview.expiresAt <= now) this.pending.delete(token);
    if (this.pending.size >= 20)
      this.pending.delete(this.pending.keys().next().value!);
    const value = {
      ...preview,
      token: randomUUID(),
      expiresAt: now + 5 * 60_000,
    };
    this.pending.set(value.token, {
      preview: value,
      fingerprint: this.fingerprint(context),
    });
    return value;
  }
  consume(token: string, context: unknown, now = Date.now()) {
    const item = this.pending.get(token);
    this.pending.delete(token);
    if (
      !item ||
      item.preview.expiresAt <= now ||
      item.fingerprint !== this.fingerprint(context)
    )
      throw new Error(
        "This preview expired or the settings changed. Preview the operation again."
      );
    return item.preview;
  }
  peek(token: string, now = Date.now()) {
    const item = this.pending.get(token);
    if (!item || item.preview.expiresAt <= now)
      throw new Error("Preview the operation again before confirming it.");
    return item.preview;
  }
}
