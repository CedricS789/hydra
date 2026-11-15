import type { DetectedSaveGame, GameShop, ShopAssets } from "@types";
import { gamesSublevel, levelKeys } from "@main/level";
import { getGameAssets } from "../events/catalogue/get-game-assets";
import { HydraApi } from "./hydra-api";

const ROMAN_MAP: Record<string, string> = {
  ii: "2",
  iii: "3",
  iv: "4",
  v: "5",
  vi: "6",
  vii: "7",
  viii: "8",
  ix: "9",
  x: "10",
  xi: "11",
  xii: "12",
  xiii: "13",
  xiv: "14",
  xv: "15",
  xvi: "16",
};

export const toArabicNumerals = (value: string): string =>
  value.replace(
    /\b(xvi|xv|xiv|xiii|xii|xi|x|ix|viii|vii|vi|v|iv|iii|ii)\b/gi,
    (match) => ROMAN_MAP[match.toLowerCase()] ?? match
  );

export const normalizeTitleForMatch = (value: string): string =>
  toArabicNumerals(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");

interface CatalogueSuggestion {
  objectId: string;
  shop: "steam" | "launchbox";
  title: string;
}

interface EpicKeyImage {
  type: string;
  url: string | null;
}

interface EpicSearchElement {
  id: string;
  namespace: string;
  title: string;
  items?: Array<{ id: string; namespace: string }>;
  keyImages?: EpicKeyImage[] | null;
}

const EPIC_SEARCH_QUERY = `query($keywords: String!) {
  Catalog {
    searchStore(keywords: $keywords, locale: "en-US", country: "US", count: 10) {
      elements {
        id
        namespace
        title
        items { id namespace }
        keyImages { type url }
      }
    }
  }
}`;

const steamFallbackAssets = (
  steamId: string,
  title: string,
  assets?: ShopAssets | null
) => {
  const coverImageUrl =
    assets?.coverImageUrl ||
    `https://shared.cloudflare.steamstatic.com/store_item_assets/steam/apps/${steamId}/library_600x900.jpg`;
  const libraryHeroImageUrl =
    assets?.libraryHeroImageUrl ||
    `https://shared.cloudflare.steamstatic.com/store_item_assets/steam/apps/${steamId}/library_hero.jpg`;
  const logoImageUrl =
    assets?.logoImageUrl ||
    `https://shared.cloudflare.steamstatic.com/store_item_assets/steam/apps/${steamId}/logo.png`;
  const iconUrl = assets?.iconUrl || coverImageUrl;
  return {
    title,
    iconUrl,
    coverImageUrl,
    libraryHeroImageUrl,
    logoImageUrl,
  };
};

const searchHydraCatalogue = async (
  title: string
): Promise<CatalogueSuggestion | null> => {
  const targetNorm = normalizeTitleForMatch(title);
  if (!targetNorm) return null;
  const queries = Array.from(new Set([title, toArabicNumerals(title)]));
  for (const shop of ["steam", "launchbox"] as const) {
    for (const query of queries) {
      try {
        const suggestions = await HydraApi.get<CatalogueSuggestion[]>(
          "/catalogue/search/suggestions",
          {
            query,
            limit: 8,
            shop,
          },
          { needsAuth: false, timeout: 4000 }
        );
        if (!Array.isArray(suggestions)) continue;
        const matches = suggestions.filter(
          (item) =>
            item.shop === shop &&
            normalizeTitleForMatch(item.title) === targetNorm
        );
        if (new Set(matches.map((item) => item.objectId)).size === 1)
          return matches[0];
      } catch {
        /* Network or catalogue unavailability must never block save discovery. */
      }
    }
  }
  return null;
};

const searchEpicStorefront = async (
  title: string
): Promise<{
  objectId: string;
  iconUrl: string | null;
  coverImageUrl: string | null;
  libraryHeroImageUrl: string | null;
  logoImageUrl: string | null;
} | null> => {
  const targetNorm = normalizeTitleForMatch(title);
  if (!targetNorm) return null;
  const queries = Array.from(new Set([toArabicNumerals(title), title]));
  for (const keywords of queries) {
    try {
      const response = await fetch(
        "https://launcher.store.epicgames.com/graphql",
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            Accept: "application/json",
            "User-Agent": "EpicGamesLauncher/15.0.0",
            Origin: "https://store.epicgames.com",
            Referer: "https://store.epicgames.com/",
          },
          body: JSON.stringify({
            query: EPIC_SEARCH_QUERY,
            variables: { keywords },
          }),
          signal: AbortSignal.timeout(4000),
        }
      );
      if (!response.ok) continue;
      const payload = (await response.json()) as {
        data?: {
          Catalog?: {
            searchStore?: {
              elements?: EpicSearchElement[];
            };
          };
        };
      };
      const elements = payload.data?.Catalog?.searchStore?.elements ?? [];
      const match = elements.find(
        (el) =>
          normalizeTitleForMatch(el.title) === targetNorm &&
          Boolean(el.namespace && el.items?.[0]?.id)
      );
      if (!match || !match.items?.[0]?.id) continue;
      const objectId = `${match.namespace}:${match.items[0].id}`;
      const images = match.keyImages ?? [];
      const byType = (types: string[]) => {
        for (const type of types) {
          const found = images.find(
            (img) => img.type === type && typeof img.url === "string" && img.url
          );
          if (found?.url) return found.url;
        }
        return null;
      };
      const coverImageUrl = byType([
        "OfferImageTall",
        "DieselStoreFrontTall",
        "Thumbnail",
      ]);
      const libraryHeroImageUrl =
        byType(["OfferImageWide", "DieselStoreFrontWide"]) ?? coverImageUrl;
      const logoImageUrl = byType(["ProductLogo", "DieselGameBoxLogo"]);
      const iconUrl =
        byType(["Thumbnail", "OfferImageTall", "DieselGameBoxLogo"]) ??
        coverImageUrl;

      return {
        objectId,
        iconUrl,
        coverImageUrl,
        libraryHeroImageUrl,
        logoImageUrl,
      };
    } catch {
      /* Epic storefront lookup is best-effort. */
    }
  }
  return null;
};

const enrichSingleEntry = async (
  entry: DetectedSaveGame
): Promise<DetectedSaveGame> => {
  const resolveLibraryMatch = async (shop: GameShop, objectId: string) => {
    if (entry.matchedGameKey) {
      return {
        matchedGameKey: entry.matchedGameKey,
        matchedTitle: entry.matchedTitle,
      };
    }
    const existing = await gamesSublevel
      .get(levelKeys.game(shop, objectId))
      .catch(() => null);
    if (existing && !existing.isDeleted) {
      return {
        matchedGameKey: `${existing.shop}:${existing.objectId}`,
        matchedTitle: existing.title,
      };
    }
    return {};
  };

  if (entry.steamId) {
    const assets = await getGameAssets(
      entry.steamId,
      "steam",
      undefined,
      4000
    ).catch(() => null);
    const artwork = steamFallbackAssets(entry.steamId, entry.title, assets);
    const libMatch = await resolveLibraryMatch("steam", entry.steamId);
    return {
      ...entry,
      ...libMatch,
      matchedShop: "steam",
      matchedObjectId: entry.steamId,
      iconUrl: artwork.iconUrl,
      coverImageUrl: artwork.coverImageUrl,
      libraryHeroImageUrl: artwork.libraryHeroImageUrl,
      logoImageUrl: artwork.logoImageUrl,
    };
  }

  const catalogueMatch = await searchHydraCatalogue(entry.title);
  if (catalogueMatch) {
    const assets = await getGameAssets(
      catalogueMatch.objectId,
      catalogueMatch.shop,
      undefined,
      4000
    ).catch(() => null);
    const libMatch = await resolveLibraryMatch(
      catalogueMatch.shop,
      catalogueMatch.objectId
    );
    if (catalogueMatch.shop === "steam") {
      const artwork = steamFallbackAssets(
        catalogueMatch.objectId,
        entry.title,
        assets
      );
      return {
        ...entry,
        ...libMatch,
        steamId: catalogueMatch.objectId,
        matchedShop: "steam",
        matchedObjectId: catalogueMatch.objectId,
        iconUrl: artwork.iconUrl,
        coverImageUrl: artwork.coverImageUrl,
        libraryHeroImageUrl: artwork.libraryHeroImageUrl,
        logoImageUrl: artwork.logoImageUrl,
      };
    }
    return {
      ...entry,
      ...libMatch,
      matchedShop: "launchbox",
      matchedObjectId: catalogueMatch.objectId,
      iconUrl: assets?.iconUrl ?? assets?.coverImageUrl ?? null,
      coverImageUrl: assets?.coverImageUrl ?? null,
      libraryHeroImageUrl: assets?.libraryHeroImageUrl ?? null,
      logoImageUrl: assets?.logoImageUrl ?? null,
    };
  }

  const epicMatch = await searchEpicStorefront(entry.title);
  if (epicMatch) {
    const libMatch = await resolveLibraryMatch("epic", epicMatch.objectId);
    return {
      ...entry,
      ...libMatch,
      matchedShop: "epic",
      matchedObjectId: epicMatch.objectId,
      iconUrl: epicMatch.iconUrl,
      coverImageUrl: epicMatch.coverImageUrl,
      libraryHeroImageUrl: epicMatch.libraryHeroImageUrl,
      logoImageUrl: epicMatch.logoImageUrl,
    };
  }

  return {
    ...entry,
    matchedShop: "custom",
  };
};

export const enrichDetectedSaveGames = async (
  entries: DetectedSaveGame[],
  report?: (completed: number, total: number, titles: string[]) => void
): Promise<DetectedSaveGame[]> => {
  const results = new Array<DetectedSaveGame>(entries.length);
  const concurrency = 6;
  let index = 0;
  let completed = 0;
  const active = new Set<string>();

  const worker = async () => {
    while (index < entries.length) {
      const current = index++;
      active.add(entries[current].title);
      report?.(completed, entries.length, [...active]);
      try {
        results[current] = await enrichSingleEntry(entries[current]);
      } catch {
        // Metadata is optional: preserve save results if a provider fails.
        results[current] = entries[current];
      }
      active.delete(entries[current].title);
      report?.(++completed, entries.length, [...active]);
    }
  };

  await Promise.all(
    Array.from({ length: Math.min(concurrency, entries.length) }, () =>
      worker()
    )
  );
  return results;
};
