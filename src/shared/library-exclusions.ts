import type {
  ExcludedLibraryGame,
  ExcludedLibraryGameInput,
  GameShop,
  LibraryExclusionReason,
} from "@types";

export interface ExcludedLibraryTarget {
  shop: GameShop;
  objectId: string;
}

const VALID_REASONS = new Set<LibraryExclusionReason>([
  "removed",
  "manual",
  "steam-bulk",
  "bulk",
]);

export const getExcludedLibraryGameKey = (
  shop: GameShop,
  objectId: string
): string => `${shop}:${String(objectId ?? "").trim()}`;

export const normalizeExcludedLibraryGame = (
  entry: Partial<ExcludedLibraryGameInput> | null | undefined
): ExcludedLibraryGame | null => {
  if (!entry) return null;
  const shop = entry.shop;
  const objectId = String(entry.objectId ?? "").trim();
  if (!shop || !objectId) return null;

  const title = String(entry.title ?? "").trim() || `${shop}:${objectId}`;
  const reason =
    entry.reason && VALID_REASONS.has(entry.reason) ? entry.reason : "removed";
  const excludedAt =
    typeof entry.excludedAt === "number" && Number.isFinite(entry.excludedAt)
      ? entry.excludedAt
      : Date.now();

  return {
    shop,
    objectId,
    title,
    source: entry.source ?? null,
    iconUrl: entry.iconUrl ?? null,
    libraryImageUrl: entry.libraryImageUrl ?? null,
    reason,
    excludedAt,
  };
};

export const normalizeExcludedLibraryList = (
  entries: unknown
): ExcludedLibraryGame[] => {
  if (!Array.isArray(entries)) return [];
  const byKey = new Map<string, ExcludedLibraryGame>();

  for (const raw of entries) {
    const normalized = normalizeExcludedLibraryGame(
      raw as Partial<ExcludedLibraryGameInput>
    );
    if (!normalized) continue;
    byKey.set(
      getExcludedLibraryGameKey(normalized.shop, normalized.objectId),
      normalized
    );
  }

  return sortExcludedLibraryGames(Array.from(byKey.values()));
};

export const sortExcludedLibraryGames = (
  entries: ExcludedLibraryGame[]
): ExcludedLibraryGame[] =>
  [...entries].sort((a, b) => {
    if (b.excludedAt !== a.excludedAt) {
      return b.excludedAt - a.excludedAt;
    }
    return a.title.localeCompare(b.title);
  });

export const mergeExcludedLibraryGames = (
  existing: ExcludedLibraryGame[],
  additions: ExcludedLibraryGameInput[],
  now = Date.now()
): { entries: ExcludedLibraryGame[]; addedCount: number } => {
  const byKey = new Map<string, ExcludedLibraryGame>();

  for (const entry of existing) {
    const normalized = normalizeExcludedLibraryGame(entry);
    if (!normalized) continue;
    byKey.set(
      getExcludedLibraryGameKey(normalized.shop, normalized.objectId),
      normalized
    );
  }

  let addedCount = 0;

  for (const rawAddition of additions) {
    const normalized = normalizeExcludedLibraryGame({
      ...rawAddition,
      excludedAt: rawAddition.excludedAt ?? now,
    });
    if (!normalized) continue;

    const key = getExcludedLibraryGameKey(normalized.shop, normalized.objectId);
    const prev = byKey.get(key);
    if (!prev) {
      addedCount += 1;
      byKey.set(key, normalized);
      continue;
    }

    byKey.set(key, {
      ...prev,
      title:
        rawAddition.title && rawAddition.title.trim()
          ? rawAddition.title.trim()
          : prev.title,
      source: rawAddition.source ?? prev.source ?? null,
      iconUrl: rawAddition.iconUrl ?? prev.iconUrl ?? null,
      libraryImageUrl:
        rawAddition.libraryImageUrl ?? prev.libraryImageUrl ?? null,
      reason: rawAddition.reason ?? prev.reason ?? "removed",
      excludedAt: rawAddition.excludedAt ?? prev.excludedAt,
    });
  }

  return {
    entries: sortExcludedLibraryGames(Array.from(byKey.values())),
    addedCount,
  };
};

export const removeExcludedLibraryGames = (
  existing: ExcludedLibraryGame[],
  targets: ExcludedLibraryTarget[]
): { entries: ExcludedLibraryGame[]; removedCount: number } => {
  const targetKeys = new Set(
    targets
      .map((target) =>
        target?.shop && target?.objectId
          ? getExcludedLibraryGameKey(target.shop, target.objectId)
          : ""
      )
      .filter(Boolean)
  );

  if (targetKeys.size === 0) {
    return { entries: existing, removedCount: 0 };
  }

  const remaining: ExcludedLibraryGame[] = [];
  let removedCount = 0;

  for (const entry of existing) {
    const key = getExcludedLibraryGameKey(entry.shop, entry.objectId);
    if (targetKeys.has(key)) {
      removedCount += 1;
    } else {
      remaining.push(entry);
    }
  }

  return {
    entries: sortExcludedLibraryGames(remaining),
    removedCount,
  };
};

export const buildExcludedLibraryKeySet = (
  entries: ExcludedLibraryTarget[]
): Set<string> => {
  const keys = new Set<string>();
  for (const entry of entries) {
    if (!entry?.shop || !entry?.objectId) continue;
    keys.add(getExcludedLibraryGameKey(entry.shop, entry.objectId));
  }
  return keys;
};

export const isExcludedLibraryTarget = (
  excludedKeys: ReadonlySet<string>,
  shop: GameShop,
  objectId: string
): boolean => excludedKeys.has(getExcludedLibraryGameKey(shop, objectId));

export const filterExcludedLibraryGames = (
  entries: ExcludedLibraryGame[],
  options?: {
    query?: string;
    shop?: GameShop | "all";
  }
): ExcludedLibraryGame[] => {
  const query = String(options?.query ?? "")
    .trim()
    .toLowerCase();
  const shop = options?.shop ?? "all";

  return entries.filter((entry) => {
    if (shop !== "all" && entry.shop !== shop) {
      return false;
    }
    if (!query) return true;
    return (
      entry.title.toLowerCase().includes(query) ||
      entry.objectId.toLowerCase().includes(query) ||
      entry.shop.toLowerCase().includes(query)
    );
  });
};
