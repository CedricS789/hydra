import type { Download, Game, GameShop } from "@types";
import {
  dedupeBulkLibraryRemovalTargets,
  getBulkLibraryRemovalBlockReason,
  validateBulkLibraryRemovalConfirmation,
  type BulkLibraryRemovalResult,
  type BulkLibraryRemovalTarget,
} from "../../shared/bulk-library-removal.js";

export interface BulkRemoveLibraryGamesDeps {
  getGame: (shop: GameShop, objectId: string) => Promise<Game | undefined>;
  getDownload: (
    shop: GameShop,
    objectId: string
  ) => Promise<Download | undefined>;
  isGameActive: (shop: GameShop, objectId: string) => boolean;
  isGameDownloading: (download: Download | undefined) => boolean;
  removeGame: (shop: GameShop, objectId: string) => Promise<void>;
}

export async function executeBulkRemoveLibraryGames(
  targets: readonly BulkLibraryRemovalTarget[],
  confirmation: string | undefined,
  deps: BulkRemoveLibraryGamesDeps
): Promise<BulkLibraryRemovalResult> {
  const uniqueTargets = dedupeBulkLibraryRemovalTargets(targets);
  validateBulkLibraryRemovalConfirmation(uniqueTargets.length, confirmation);

  const removed: BulkLibraryRemovalResult["removed"] = [];
  const skipped: BulkLibraryRemovalResult["skipped"] = [];
  const failed: BulkLibraryRemovalResult["failed"] = [];

  for (const target of uniqueTargets) {
    const game = await deps.getGame(target.shop, target.objectId);
    if (!game || game.isDeleted) {
      skipped.push({
        shop: target.shop,
        objectId: target.objectId,
        title: game?.title || target.objectId,
        reason: "not_found",
      });
      continue;
    }

    const download = await deps.getDownload(target.shop, target.objectId);
    const blockReason = getBulkLibraryRemovalBlockReason({
      isRunning: deps.isGameActive(target.shop, target.objectId),
      isDownloading: deps.isGameDownloading(download),
    });

    if (blockReason) {
      skipped.push({
        shop: target.shop,
        objectId: target.objectId,
        title: game.title || target.objectId,
        reason: blockReason,
      });
      continue;
    }

    try {
      await deps.removeGame(target.shop, target.objectId);
      removed.push(target);
    } catch (error) {
      failed.push({
        shop: target.shop,
        objectId: target.objectId,
        title: game.title || target.objectId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return { removed, skipped, failed };
}
