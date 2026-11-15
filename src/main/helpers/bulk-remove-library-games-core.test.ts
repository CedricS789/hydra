import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { Download, Game, GameShop } from "@types";
import { executeBulkRemoveLibraryGames } from "./bulk-remove-library-games-core.js";

const makeGame = (
  shop: GameShop,
  objectId: string,
  title: string,
  overrides: Partial<Game> = {}
): Game =>
  ({
    title,
    shop,
    objectId,
    remoteId: null,
    playTimeInMilliseconds: 0,
    lastTimePlayed: null,
    iconUrl: null,
    isDeleted: false,
    ...overrides,
  }) as Game;

describe("executeBulkRemoveLibraryGames", () => {
  it("rejects calls without exact REMOVE <count> confirmation", async () => {
    await assert.rejects(() =>
      executeBulkRemoveLibraryGames(
        [{ shop: "steam", objectId: "1" }],
        "REMOVE 2",
        {
          getGame: async () => undefined,
          getDownload: async () => undefined,
          isGameActive: () => false,
          isGameDownloading: () => false,
          removeGame: async () => {},
        }
      )
    );
  });

  it("removes eligible entries while skipping running, downloading, and deleted items", async () => {
    const removedKeys: string[] = [];
    const games = new Map<string, Game>([
      ["steam:1", makeGame("steam", "1", "Eligible Game")],
      ["steam:2", makeGame("steam", "2", "Running Game")],
      ["epic:3", makeGame("epic", "3", "Downloading Game")],
      [
        "custom:4",
        makeGame("custom", "4", "Already Deleted", { isDeleted: true }),
      ],
      ["steam:5", makeGame("steam", "5", "Failing Game")],
    ]);

    const result = await executeBulkRemoveLibraryGames(
      [
        { shop: "steam", objectId: "1" },
        { shop: "steam", objectId: "1" },
        { shop: "steam", objectId: "2" },
        { shop: "epic", objectId: "3" },
        { shop: "custom", objectId: "4" },
        { shop: "steam", objectId: "5" },
      ],
      "REMOVE 5",
      {
        getGame: async (shop, objectId) => games.get(`${shop}:${objectId}`),
        getDownload: async (shop, objectId) =>
          objectId === "3" && shop === "epic"
            ? ({ status: "active" } as Download)
            : undefined,
        isGameActive: (shop, objectId) => shop === "steam" && objectId === "2",
        isGameDownloading: (download) => download?.status === "active",
        removeGame: async (shop, objectId) => {
          if (objectId === "5") throw new Error("Disk busy");
          removedKeys.push(`${shop}:${objectId}`);
        },
      }
    );

    assert.deepEqual(removedKeys, ["steam:1"]);
    assert.deepEqual(result.removed, [{ shop: "steam", objectId: "1" }]);
    assert.deepEqual(result.skipped, [
      {
        shop: "steam",
        objectId: "2",
        title: "Running Game",
        reason: "running",
      },
      {
        shop: "epic",
        objectId: "3",
        title: "Downloading Game",
        reason: "downloading",
      },
      {
        shop: "custom",
        objectId: "4",
        title: "Already Deleted",
        reason: "not_found",
      },
    ]);
    assert.deepEqual(result.failed, [
      {
        shop: "steam",
        objectId: "5",
        title: "Failing Game",
        error: "Disk busy",
      },
    ]);
  });
});
