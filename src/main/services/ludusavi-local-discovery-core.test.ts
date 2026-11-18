import assert from "node:assert/strict";
import test from "node:test";
import type { Game, LudusaviLocalSettings } from "../../types/index";
import { detectedSaveGames } from "./ludusavi-local-discovery-core.js";

const settings: LudusaviLocalSettings = {
  enabled: false,
  destination: "D:/Backups",
  fullRetention: 10,
  exitDelaySeconds: 10,
  games: {},
};
const game = (title: string, shop: Game["shop"], objectId: string) =>
  ({ title, shop, objectId, isDeleted: false }) as Game;

test("discovery only offers entries with actual non-excluded data, not the supported catalogue", () => {
  const result = detectedSaveGames(
    {
      games: {
        Found: { decision: "Processed", files: { "D:/save": { bytes: 1 } } },
        RegistryOnly: {
          decision: "Processed",
          registry: { "HKCU/Example": {} },
        },
        Empty: { decision: "Processed", files: {} },
        Excluded: {
          decision: "Processed",
          files: { hidden: { ignored: true } },
        },
        Failed: { decision: "Processed", files: { bad: { failed: true } } },
      },
    },
    { SupportedOnly: { steam: { id: 999 } } },
    "saves",
    [],
    settings
  );
  assert.deepEqual(
    result.map((item) => item.title),
    ["Found", "RegistryOnly"]
  );
});

test("Steam identities are taken only from valid manifest IDs and preserve edition distinctions", () => {
  const data = {
    games: { Game: { decision: "Processed", files: { save: {} } } },
  };
  const library = [
    game("Game", "steam", "456"),
    game("Different display name", "steam", "123"),
    game("Game", "custom", "custom"),
  ];
  const result = detectedSaveGames(
    data,
    { Game: { steam: { id: 123 } } },
    "saves",
    library,
    settings
  );
  assert.equal(result[0].steamId, "123");
  assert.deepEqual(result[0].matchingGameKeys, ["steam:123", "custom:custom"]);
  const invalid = detectedSaveGames(
    data,
    { Game: { steam: { id: -1 } } },
    "saves",
    [],
    settings
  );
  assert.equal(invalid[0].steamId, undefined);
});

test("archive discovery works with no live saves and recognizes explicit links", () => {
  const library = [game("Personal title", "custom", "existing")];
  const result = detectedSaveGames(
    {
      games: {
        Canonical: {
          backups: [{ name: "one.zip", when: "2026-01-01", locked: false }],
        },
        Empty: { backups: [] },
      },
    },
    {},
    "backups",
    library,
    {
      ...settings,
      games: {
        "custom:existing": {
          enabled: false,
          savePaths: [],
          trackingPaths: [],
          manifestTitle: "Canonical",
        },
      },
    }
  );
  assert.equal(result.length, 1);
  assert.equal(result[0].versions, 1);
  assert.deepEqual(result[0].matchingGameKeys, ["custom:existing"]);
  assert.equal(result[0].files, 0);
});

test("title matching is exact, skips deleted games, and path previews are bounded", () => {
  const result = detectedSaveGames(
    {
      games: {
        Game: {
          decision: "Processed",
          files: Object.fromEntries(
            Array.from({ length: 100 }, (_, i) => [`file-${i}`, {}])
          ),
        },
      },
    },
    {},
    "saves",
    [
      game(" game ", "custom", "same"),
      game("Game 2", "custom", "other"),
      { ...game("Game", "custom", "deleted"), isDeleted: true },
    ],
    settings
  );
  assert.deepEqual(result[0].matchingGameKeys, ["custom:same"]);
  assert.equal(result[0].files, 100);
  assert.equal(result[0].filePaths.length, 50);
});

test("reserved Hydra config backup entry is excluded from game discovery", () => {
  const result = detectedSaveGames(
    {
      games: {
        "Hydra Ludusavi Config": {
          decision: "Processed",
          backups: [{ name: "backup-1.zip", when: "2026-01-01", locked: false }],
          files: { "C:/hydra/manifest.json": { bytes: 120 } },
        },
        "Real Game": {
          decision: "Processed",
          backups: [{ name: "backup-2.zip", when: "2026-01-01", locked: false }],
        },
      },
    },
    {},
    "backups",
    [],
    settings
  );
  assert.deepEqual(
    result.map((item) => item.title),
    ["Real Game"]
  );
});
