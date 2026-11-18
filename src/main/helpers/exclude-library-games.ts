import type {
  ExcludedLibraryGame,
  ExcludedLibraryGameInput,
  Game,
} from "@types";
import type { ExcludedLibraryTarget } from "@shared";
import { gamesShopAssetsSublevel, gamesSublevel, levelKeys } from "@main/level";
import { WindowManager } from "@main/services";
import { createGame } from "@main/services/library-sync";
import {
  excludeLibraryGamesOnly,
  getExcludedLibraryGames,
  unexcludeLibraryGames,
} from "@main/services/library-exclusions";
import { removeLibraryGame } from "./remove-library-game";

export const excludeLibraryGames = async (
  inputs: ExcludedLibraryGameInput[]
): Promise<{
  entries: ExcludedLibraryGame[];
  addedCount: number;
  removedFromLibraryCount: number;
}> => {
  const enrichedInputs: ExcludedLibraryGameInput[] = [];
  const toRemove: ExcludedLibraryTarget[] = [];

  for (const input of inputs) {
    const objectId = String(input?.objectId ?? "").trim();
    if (!input?.shop || !objectId) continue;

    const gameKey = levelKeys.game(input.shop, objectId);
    const [existingGame, existingAssets] = await Promise.all([
      gamesSublevel.get(gameKey).catch(() => undefined),
      gamesShopAssetsSublevel.get(gameKey).catch(() => undefined),
    ]);

    enrichedInputs.push({
      ...input,
      objectId,
      title:
        input.title?.trim() ||
        existingGame?.title ||
        existingAssets?.title ||
        `${input.shop}:${objectId}`,
      source: input.source ?? existingGame?.source ?? null,
      iconUrl:
        input.iconUrl ??
        existingGame?.iconUrl ??
        existingAssets?.iconUrl ??
        null,
      libraryImageUrl:
        input.libraryImageUrl ??
        existingGame?.libraryHeroImageUrl ??
        existingAssets?.libraryHeroImageUrl ??
        existingAssets?.coverImageUrl ??
        null,
    });

    if (existingGame && !existingGame.isDeleted) {
      toRemove.push({ shop: input.shop, objectId });
    }
  }

  let removedFromLibraryCount = 0;
  for (const target of toRemove) {
    await removeLibraryGame(target.shop, target.objectId, {
      skipExclude: true,
    });
    removedFromLibraryCount += 1;
  }

  const result = await excludeLibraryGamesOnly(enrichedInputs);

  if (removedFromLibraryCount > 0) {
    WindowManager.sendToAppWindows("on-library-batch-complete");
  }

  return {
    ...result,
    removedFromLibraryCount,
  };
};

export const restoreExcludedLibraryGames = async (
  targets: ExcludedLibraryTarget[]
): Promise<{
  entries: ExcludedLibraryGame[];
  removedCount: number;
  restoredCount: number;
}> => {
  const previousEntries = await getExcludedLibraryGames();
  const previousByKey = new Map(
    previousEntries.map((entry) => [
      levelKeys.game(entry.shop, entry.objectId),
      entry,
    ])
  );
  const { entries, removedCount } = await unexcludeLibraryGames(targets);
  let restoredCount = 0;

  for (const target of targets) {
    const objectId = String(target?.objectId ?? "").trim();
    if (!target?.shop || !objectId) continue;

    const gameKey = levelKeys.game(target.shop, objectId);
    const existing = await gamesSublevel.get(gameKey).catch(() => undefined);

    if (existing) {
      if (existing.isDeleted) {
        const restoredGame: Game = {
          ...existing,
          isDeleted: false,
          addedToLibraryAt: existing.addedToLibraryAt ?? new Date(),
          source: existing.source ?? "hydra",
        };
        await gamesSublevel.put(gameKey, restoredGame);
        await createGame(restoredGame).catch(() => {});
        restoredCount += 1;
      }
      continue;
    }

    const assets = await gamesShopAssetsSublevel
      .get(gameKey)
      .catch(() => undefined);
    const excludedMeta = previousByKey.get(gameKey);
    const newGame: Game = {
      title:
        assets?.title ?? excludedMeta?.title ?? `${target.shop}:${objectId}`,
      iconUrl: assets?.iconUrl ?? excludedMeta?.iconUrl ?? null,
      libraryHeroImageUrl:
        assets?.libraryHeroImageUrl ?? excludedMeta?.libraryImageUrl ?? null,
      logoImageUrl: assets?.logoImageUrl ?? null,
      objectId,
      shop: target.shop,
      remoteId: null,
      isDeleted: false,
      playTimeInMilliseconds: 0,
      lastTimePlayed: null,
      addedToLibraryAt: new Date(),
      source: "hydra",
    };

    await gamesSublevel.put(gameKey, newGame);
    await createGame(newGame).catch(() => {});
    restoredCount += 1;
  }

  if (restoredCount > 0) {
    WindowManager.sendToAppWindows("on-library-batch-complete");
  }

  return {
    entries,
    removedCount,
    restoredCount,
  };
};
