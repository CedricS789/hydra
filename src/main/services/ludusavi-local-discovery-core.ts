import { createHash } from "node:crypto";
import type {
  DetectedSaveGame,
  Game,
  LudusaviLocalSettings,
} from "../../types/index";
import type { SaveApiResponse } from "./ludusavi-local-api";
import { HYDRA_CONFIG_BACKUP_ENTRY } from "../../shared/hydra-config-backup.js";

export type SaveManifest = Record<
  string,
  { steam?: { id?: number }; alias?: string }
>;

export function detectedSaveGames(
  data: SaveApiResponse,
  manifest: SaveManifest,
  source: DetectedSaveGame["source"],
  library: Game[],
  settings: LudusaviLocalSettings
): DetectedSaveGame[] {
  return Object.entries(data.games ?? {})
    .flatMap(([title, entry]) => {
      if (
        title.normalize("NFC").trim().toLowerCase() ===
        HYDRA_CONFIG_BACKUP_ENTRY.toLowerCase()
      )
        return [];
      const paths = Object.entries(entry.files ?? {})
        .filter(([, file]) => !file.ignored && !file.failed && !file.error)
        .map(([file]) => file);
      const registry = Object.values(entry.registry ?? {}).filter(
        (item) => !item.ignored && !item.failed && !item.error
      ).length;
      const versions = entry.backups?.length ?? 0;
      if (
        source === "saves"
          ? (!paths.length && !registry) || entry.decision !== "Processed"
          : !versions
      )
        return [];
      const id = manifest[title]?.steam?.id;
      const steamId =
        typeof id === "number" &&
        Number.isSafeInteger(id) &&
        id > 0 &&
        id <= 4294967295
          ? String(id)
          : undefined;
      const matchingGameKeys = library
        .filter((game) => {
          if (game.isDeleted) return false;
          const key = `${game.shop}:${game.objectId}`;
          if (steamId && game.shop === "steam")
            return game.objectId === steamId;
          return (
            (settings.games[key]?.manifestTitle ?? game.title)
              .normalize("NFC")
              .trim()
              .toLowerCase() === title.normalize("NFC").trim().toLowerCase()
          );
        })
        .map((game) => `${game.shop}:${game.objectId}`);
      return [
        {
          id: createHash("sha256").update(title).digest("hex"),
          title,
          source,
          steamId,
          files: paths.length,
          registryKeys: registry,
          versions,
          filePaths: paths.slice(0, 50),
          matchingGameKeys,
        },
      ];
    })
    .sort((a, b) => a.title.localeCompare(b.title));
}
