import fs from "node:fs/promises";
import path from "node:path";
import YAML from "yaml";
import { createHash } from "node:crypto";
import type {
  AddDetectedSaveGameRequest,
  DetectedSaveGame,
  Game,
  GameShop,
} from "@types";
import { gamesSublevel } from "../level/sublevels/games";
import { db } from "../level/level";
import {
  getLudusaviLocalSettings,
  localSaveTools as tools,
} from "./ludusavi-local";
import { runSaveToolCommand } from "./ludusavi-local-manager";
import { acquireSaveBackupLock } from "./ludusavi-local-lock";
import {
  assertSaveApiSuccess,
  type SaveApiResponse,
} from "./ludusavi-local-api";
import {
  detectedSaveGames,
  type SaveManifest,
} from "./ludusavi-local-discovery-core";
import { updateGameRecord } from "./game-record-updater";
import { updateGameExecutablePath } from "../helpers/update-executable-path";

let discovery:
  | { entries: DetectedSaveGame[]; context: string; expiresAt: number }
  | undefined;
const fingerprint = (value: unknown) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");
const normalizeExe = (value: string) =>
  path.win32.normalize(value).toLowerCase();

export const scanDetectedSaveGames = (source: "saves" | "backups") => {
  if (source !== "saves" && source !== "backups")
    throw new Error("Choose local saves or existing backups.");
  return tools.queue.enqueue(`discovery:scan:${source}`, async () => {
    discovery = undefined;
    const settings = await getLudusaviLocalSettings();
    const lock = await acquireSaveBackupLock(settings.destination);
    try {
      const { binary, configDir, config } =
        await tools.prepareBaseConfig(settings);
      const library = await gamesSublevel.values().all();
      if (source === "saves") {
        const rules = [...(config.customGames ?? [])];
        for (const game of library) {
          if (game.isDeleted) continue;
          const rule = settings.games[`${game.shop}:${game.objectId}`];
          if (!rule?.savePaths.length) continue;
          const name = rule.manifestTitle ?? game.title;
          const index = rules.findIndex((item) => item.name === name);
          const previous = index < 0 ? undefined : rules.splice(index, 1)[0];
          rules.push({
            ...previous,
            name,
            integration: previous?.integration ?? "extend",
            files: [
              ...new Set([...(previous?.files ?? []), ...rule.savePaths]),
            ],
          });
        }
        await fs.writeFile(
          path.join(configDir, "config.yaml"),
          YAML.stringify({ ...config, customGames: rules })
        );
      }
      const args =
        source === "saves"
          ? [
              "backup",
              "--preview",
              "--api",
              "--force",
              "--no-cloud-sync",
              "--path",
              settings.destination,
            ]
          : ["backups", "--api", "--path", settings.destination];
      const data = JSON.parse(
        await runSaveToolCommand(
          binary,
          [
            "--config",
            configDir,
            source === "saves"
              ? "--try-manifest-update"
              : "--no-manifest-update",
            ...args,
          ],
          lock
        )
      ) as SaveApiResponse;
      if (source === "saves")
        data.games = Object.fromEntries(
          Object.entries(data.games ?? {}).filter(
            ([, entry]) => entry.decision === "Processed"
          )
        );
      assertSaveApiSuccess(data);
      let manifest: SaveManifest = {};
      try {
        manifest = JSON.parse(
          await runSaveToolCommand(
            binary,
            [
              "--config",
              configDir,
              "--no-manifest-update",
              "manifest",
              "show",
              "--api",
            ],
            lock
          )
        );
      } catch {
        /* Archives remain usable without a cached manifest or store ID. */
      }
      const entries = detectedSaveGames(
        data,
        manifest,
        source,
        library,
        settings
      );
      discovery = {
        entries,
        context: fingerprint({ settings, config }),
        expiresAt: Date.now() + 15 * 60_000,
      };
      return entries;
    } finally {
      await lock.release();
    }
  });
};

export interface DetectedGameCreators {
  addSteam: (id: string, title: string) => Promise<void>;
  addCustom: (title: string, executable: string) => Promise<string>;
  executableAssigned?: (shop: GameShop, objectId: string) => Promise<void>;
}

export const addDetectedSaveGame = (
  request: AddDetectedSaveGameRequest,
  creators: DetectedGameCreators
) => {
  if (
    !request ||
    typeof request.entryId !== "string" ||
    (request.targetGameKey !== undefined &&
      typeof request.targetGameKey !== "string")
  )
    throw new Error("Select a detected entry and a valid library destination.");
  return tools.queue.enqueue(
    `discovery:add:${JSON.stringify(request)}`,
    async () => {
      const snapshot = discovery;
      const entry = snapshot?.entries.find(
        (item) => item.id === request.entryId
      );
      if (!snapshot || !entry || snapshot.expiresAt <= Date.now())
        throw new Error("Scan again before adding this detected entry.");
      if (!entry.title.trim() || entry.title.length > 1000)
        throw new Error(
          "This detected entry has an invalid title and cannot be added."
        );
      const settings = await getLudusaviLocalSettings();
      const { config } = await tools.prepareBaseConfig(settings);
      if (snapshot.context !== fingerprint({ settings, config }))
        throw new Error(
          "Settings changed since the scan. Scan again before adding games."
        );
      const library = (await gamesSublevel.values().all()).filter(
        (game) => !game.isDeleted
      );
      let executable = request.executablePath;
      if (executable !== undefined && typeof executable !== "string")
        throw new Error("Choose a valid executable path.");
      executable = executable?.trim() || undefined;
      if (
        executable &&
        (!path.isAbsolute(executable) ||
          path.extname(executable).toLowerCase() !== ".exe" ||
          !(await fs.stat(executable)).isFile())
      )
        throw new Error(
          "Choose the actual installed Windows game executable (.exe)."
        );
      let game: Game | undefined;
      if (request.targetGameKey) {
        game = library.find(
          (item) => `${item.shop}:${item.objectId}` === request.targetGameKey
        );
        if (!game)
          throw new Error("The selected library entry no longer exists.");
      } else {
        // Exact store identity or an identical executable is safe for deduplication.
        game = library.find(
          (item) =>
            (entry.steamId &&
              item.shop === "steam" &&
              item.objectId === entry.steamId) ||
            (executable &&
              item.executablePath &&
              normalizeExe(item.executablePath) === normalizeExe(executable))
        );
      }
      if (
        executable &&
        library.some(
          (item) =>
            item.executablePath &&
            normalizeExe(item.executablePath) === normalizeExe(executable) &&
            item !== game
        )
      )
        throw new Error(
          "This executable already belongs to another library entry. Link to that entry instead."
        );
      if (
        game?.executablePath &&
        executable &&
        normalizeExe(game.executablePath) !== normalizeExe(executable)
      )
        throw new Error(
          "This entry already has an executable. Change it through the game's normal options if needed."
        );
      let key = game ? `${game.shop}:${game.objectId}` : "";
      if (!game && entry.steamId) {
        await creators.addSteam(entry.steamId, entry.title);
        key = `steam:${entry.steamId}`;
        game = await gamesSublevel.get(key);
      } else if (!game) {
        if (!executable)
          throw new Error(
            "No reliable store ID is available. Choose the executable to create a custom library entry, or link an existing game."
          );
        key = await creators.addCustom(entry.title, executable);
        game = await gamesSublevel.get(key);
      }
      if (!game)
        throw new Error(
          "The library entry could not be created. No saves were changed."
        );
      if (executable && !game.executablePath) {
        // Updating the path here must not trigger any cloud restore workflow.
        await updateGameRecord(key, (current) =>
          updateGameExecutablePath(current, executable!)
        );
        await creators.executableAssigned?.(game.shop, game.objectId);
      }
      const currentRule = settings.games[key] ?? {
        enabled: true,
        savePaths: [],
        trackingPaths: [],
      };
      await db.put(
        "ludusaviLocalSettings",
        {
          ...settings,
          games: {
            ...settings.games,
            [key]: {
              ...currentRule,
              manifestTitle: entry.title,
              steamId: entry.steamId,
            },
          },
        },
        { valueEncoding: "json" }
      );
      // Keep remaining results usable without requiring another expensive scan.
      const prepared = await tools.prepareBaseConfig(
        await getLudusaviLocalSettings()
      );
      snapshot.context = fingerprint({
        settings: await getLudusaviLocalSettings(),
        config: prepared.config,
      });
      return {
        gameKey: key,
        title: game.title,
        executableRequired: !(game.executablePath || executable),
      };
    }
  );
};
