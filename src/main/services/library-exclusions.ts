import type {
  ExcludedLibraryGame,
  ExcludedLibraryGameInput,
  GameShop,
} from "@types";
import {
  getExcludedLibraryGameKey,
  mergeExcludedLibraryGames,
  normalizeExcludedLibraryList,
  removeExcludedLibraryGames,
  type ExcludedLibraryTarget,
} from "@shared";
import { excludedLibraryGamesSublevel, levelKeys } from "@main/level";
import { WindowManager } from "./window-manager";

const EXCLUDED_GAMES_UPDATED_EVENT = "on-excluded-library-games-updated";

let writeQueue: Promise<unknown> = Promise.resolve();

const enqueueWrite = <T>(work: () => Promise<T>): Promise<T> => {
  const next = writeQueue.then(work, work);
  writeQueue = next.catch(() => {});
  return next;
};

const notifyExcludedGamesUpdated = (entries: ExcludedLibraryGame[]) => {
  WindowManager.sendToAppWindows(EXCLUDED_GAMES_UPDATED_EVENT, entries);
};

export const getExcludedLibraryGames = async (): Promise<
  ExcludedLibraryGame[]
> => {
  const rawEntries = await excludedLibraryGamesSublevel
    .values()
    .all()
    .catch(() => []);
  return normalizeExcludedLibraryList(rawEntries);
};

export const getExcludedLibraryKeySet = async (): Promise<Set<string>> => {
  const keys = await excludedLibraryGamesSublevel
    .keys()
    .all()
    .catch(() => []);
  return new Set(keys);
};

export const isLibraryGameExcluded = async (
  shop: GameShop,
  objectId: string
): Promise<boolean> => {
  const normalizedId = String(objectId ?? "").trim();
  if (!shop || !normalizedId) return false;

  try {
    const existing = await excludedLibraryGamesSublevel.get(
      levelKeys.game(shop, normalizedId)
    );
    return Boolean(existing);
  } catch {
    return false;
  }
};

export const excludeLibraryGamesOnly = async (
  inputs: ExcludedLibraryGameInput[]
): Promise<{ entries: ExcludedLibraryGame[]; addedCount: number }> =>
  enqueueWrite(async () => {
    if (!Array.isArray(inputs) || inputs.length === 0) {
      const entries = await getExcludedLibraryGames();
      return { entries, addedCount: 0 };
    }

    const current = await getExcludedLibraryGames();
    const { entries, addedCount } = mergeExcludedLibraryGames(current, inputs);

    const ops = entries
      .filter((entry) =>
        inputs.some(
          (input) =>
            getExcludedLibraryGameKey(entry.shop, entry.objectId) ===
            getExcludedLibraryGameKey(input.shop, input.objectId)
        )
      )
      .map((entry) => ({
        type: "put" as const,
        key: levelKeys.game(entry.shop, entry.objectId),
        value: entry,
      }));

    if (ops.length > 0) {
      await excludedLibraryGamesSublevel.batch(ops);
      notifyExcludedGamesUpdated(entries);
    }

    return { entries, addedCount };
  });

export const unexcludeLibraryGames = async (
  targets: ExcludedLibraryTarget[]
): Promise<{ entries: ExcludedLibraryGame[]; removedCount: number }> =>
  enqueueWrite(async () => {
    if (!Array.isArray(targets) || targets.length === 0) {
      const entries = await getExcludedLibraryGames();
      return { entries, removedCount: 0 };
    }

    const current = await getExcludedLibraryGames();
    const { entries, removedCount } = removeExcludedLibraryGames(
      current,
      targets
    );

    if (removedCount === 0) {
      return { entries, removedCount: 0 };
    }

    const targetKeys = Array.from(
      new Set(
        targets
          .map((target) =>
            target?.shop && target?.objectId
              ? levelKeys.game(target.shop, String(target.objectId).trim())
              : ""
          )
          .filter(Boolean)
      )
    );

    if (targetKeys.length > 0) {
      await excludedLibraryGamesSublevel.batch(
        targetKeys.map((key) => ({
          type: "del" as const,
          key,
        }))
      );
      notifyExcludedGamesUpdated(entries);
    }

    return { entries, removedCount };
  });

export const clearExcludedLibraryGames = async (): Promise<{
  removedCount: number;
}> =>
  enqueueWrite(async () => {
    const current = await getExcludedLibraryGames();
    if (current.length === 0) {
      return { removedCount: 0 };
    }

    await excludedLibraryGamesSublevel.clear();
    notifyExcludedGamesUpdated([]);
    return { removedCount: current.length };
  });
