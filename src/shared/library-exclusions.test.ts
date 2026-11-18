import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  buildExcludedLibraryKeySet,
  filterExcludedLibraryGames,
  getExcludedLibraryGameKey,
  isExcludedLibraryTarget,
  mergeExcludedLibraryGames,
  normalizeExcludedLibraryList,
  removeExcludedLibraryGames,
} from "./library-exclusions.js";

describe("library exclusions shared helpers", () => {
  it("normalizes and deduplicates excluded entries", () => {
    const entries = normalizeExcludedLibraryList([
      {
        shop: "steam",
        objectId: " 12345 ",
        title: "Half-Life 2",
        excludedAt: 100,
      },
      {
        shop: "steam",
        objectId: "12345",
        title: "Half-Life 2 Updated",
        excludedAt: 200,
      },
      {
        shop: "custom",
        objectId: "",
        title: "Invalid",
      },
    ]);

    assert.equal(entries.length, 1);
    assert.equal(entries[0].objectId, "12345");
    assert.equal(entries[0].title, "Half-Life 2 Updated");
    assert.equal(entries[0].reason, "removed");
  });

  it("merges additions and counts newly excluded games", () => {
    const initial = normalizeExcludedLibraryList([
      {
        shop: "steam",
        objectId: "100",
        title: "Counter-Strike",
        excludedAt: 100,
      },
    ]);

    const merged = mergeExcludedLibraryGames(
      initial,
      [
        {
          shop: "steam",
          objectId: "100",
          title: "Counter-Strike",
          reason: "steam-bulk",
        },
        {
          shop: "epic",
          objectId: "abc",
          title: "Alan Wake 2",
          source: "epic",
          reason: "manual",
        },
      ],
      500
    );

    assert.equal(merged.addedCount, 1);
    assert.equal(merged.entries.length, 2);
    assert.equal(merged.entries[0].objectId, "abc");
    assert.equal(merged.entries[1].reason, "steam-bulk");
  });

  it("removes targets by shop and objectId and builds fast lookup keys", () => {
    const initial = normalizeExcludedLibraryList([
      { shop: "steam", objectId: "10", title: "Game A", excludedAt: 10 },
      { shop: "steam", objectId: "20", title: "Game B", excludedAt: 20 },
    ]);

    const keySet = buildExcludedLibraryKeySet(initial);
    assert.equal(keySet.has(getExcludedLibraryGameKey("steam", "10")), true);
    assert.equal(isExcludedLibraryTarget(keySet, "steam", "20"), true);
    assert.equal(isExcludedLibraryTarget(keySet, "epic", "20"), false);

    const { entries, removedCount } = removeExcludedLibraryGames(initial, [
      { shop: "steam", objectId: "10" },
    ]);
    assert.equal(removedCount, 1);
    assert.equal(entries.length, 1);
    assert.equal(entries[0].objectId, "20");
  });

  it("filters excluded games by query and shop", () => {
    const list = normalizeExcludedLibraryList([
      { shop: "steam", objectId: "570", title: "Dota 2", excludedAt: 30 },
      {
        shop: "epic",
        objectId: "fortnite",
        title: "Fortnite",
        excludedAt: 20,
      },
      {
        shop: "custom",
        objectId: "retro-1",
        title: "Chrono Trigger",
        excludedAt: 10,
      },
    ]);

    assert.equal(filterExcludedLibraryGames(list, { shop: "steam" }).length, 1);
    assert.equal(
      filterExcludedLibraryGames(list, { query: "chrono" })[0]?.objectId,
      "retro-1"
    );
    assert.equal(
      filterExcludedLibraryGames(list, { query: "570", shop: "steam" }).length,
      1
    );
  });
});
