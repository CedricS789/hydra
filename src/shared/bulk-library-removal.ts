import type { GameShop } from "../types/game.types";

export interface BulkLibraryRemovalTarget {
  shop: GameShop;
  objectId: string;
}

export type BulkLibraryRemovalBlockReason = "running" | "downloading";

export type BulkLibraryRemovalSkipReason =
  | BulkLibraryRemovalBlockReason
  | "not_found";

export interface BulkLibraryRemovalSkippedItem {
  shop: GameShop;
  objectId: string;
  title: string;
  reason: BulkLibraryRemovalSkipReason;
}

export interface BulkLibraryRemovalFailedItem {
  shop: GameShop;
  objectId: string;
  title: string;
  error: string;
}

export interface BulkLibraryRemovalResult {
  removed: BulkLibraryRemovalTarget[];
  skipped: BulkLibraryRemovalSkippedItem[];
  failed: BulkLibraryRemovalFailedItem[];
}

export const formatBulkLibraryRemovalConfirmation = (count: number): string =>
  Number.isInteger(count) && count > 0 ? `REMOVE ${count}` : "";

export function dedupeBulkLibraryRemovalTargets(
  targets: readonly BulkLibraryRemovalTarget[]
): BulkLibraryRemovalTarget[] {
  const seen = new Set<string>();
  const unique: BulkLibraryRemovalTarget[] = [];

  for (const target of targets) {
    if (!target?.shop || !target?.objectId) continue;
    const key = `${target.shop}:${target.objectId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push({ shop: target.shop, objectId: target.objectId });
  }

  return unique;
}

export function validateBulkLibraryRemovalConfirmation(
  count: number,
  confirmation?: string
): void {
  if (!Number.isInteger(count) || count <= 0) {
    throw new Error("Select at least one library item to remove.");
  }

  const expected = formatBulkLibraryRemovalConfirmation(count);
  if (confirmation !== expected) {
    throw new Error(
      `Type ${expected} to confirm removing ${count} library item${count === 1 ? "" : "s"}.`
    );
  }
}

export function getBulkLibraryRemovalBlockReason(options: {
  isRunning?: boolean;
  isDownloading?: boolean;
}): BulkLibraryRemovalBlockReason | null {
  if (options.isRunning) return "running";
  if (options.isDownloading) return "downloading";
  return null;
}
