/* global globalThis */
import assert from "node:assert/strict";
import { beforeEach, test } from "node:test";
import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";

const root = path.resolve(import.meta.dirname, "..");
await fs.mkdir(path.join(root, ".tmp"), { recursive: true });
const folder = await fs.mkdtemp(path.join(root, ".tmp", "metadata-tests-"));
const outfile = path.join(folder, "service.mjs");
await build({
  entryPoints: [
    path.join(root, "src/main/services/ludusavi-metadata-enrichment.ts"),
  ],
  outfile,
  bundle: true,
  platform: "node",
  format: "esm",
  plugins: [
    {
      name: "isolated-metadata",
      setup(plugin) {
        const modules = {
          "@main/level":
            "export const levelKeys={game:(s,i)=>`${s}:${i}`};export const gamesSublevel={get:async k=>globalThis.__metadata.library.get(k)};",
          "../events/catalogue/get-game-assets":
            "export const getGameAssets=(...args)=>globalThis.__metadata.assets(...args);",
          "./hydra-api":
            "export const HydraApi={get:(...args)=>globalThis.__metadata.catalogue(...args)};",
        };
        plugin.onResolve({ filter: /.*/ }, (args) =>
          Object.hasOwn(modules, args.path)
            ? { path: args.path, namespace: "fixture" }
            : undefined
        );
        plugin.onLoad({ filter: /.*/, namespace: "fixture" }, (args) => ({
          contents: modules[args.path],
          loader: "js",
        }));
      },
    },
  ],
});
const service = await import(pathToFileURL(outfile).href);
const originalFetch = globalThis.fetch;
const entry = (title, steamId) => ({
  id: title,
  title,
  steamId,
  source: "saves",
  files: 1,
  registryKeys: 0,
  versions: 0,
  filePaths: [],
  matchingGameKeys: [],
});
beforeEach(() => {
  globalThis.__metadata = {
    library: new Map(),
    assets: async () => null,
    catalogue: async () => [],
  };
  globalThis.fetch = async () => ({
    ok: true,
    json: async () => ({
      data: { Catalog: { searchStore: { elements: [] } } },
    }),
  });
});
process.on("exit", () => {
  globalThis.fetch = originalFetch;
});

test("Roman numerals match sequels without dropping their number", () => {
  assert.equal(
    service.normalizeTitleForMatch("Alan Wake II"),
    service.normalizeTitleForMatch("Alan Wake 2")
  );
  assert.notEqual(
    service.normalizeTitleForMatch("Alan Wake"),
    service.normalizeTitleForMatch("Alan Wake II")
  );
});
test("manifest Steam identity survives offline metadata and finds existing library entry", async () => {
  globalThis.__metadata.assets = async (_id, _shop, _options, timeout) => {
    assert.equal(timeout, 4000);
    throw Error("offline");
  };
  globalThis.__metadata.library.set("steam:108710", {
    shop: "steam",
    objectId: "108710",
    title: "My title",
  });
  const [result] = await service.enrichDetectedSaveGames([
    entry("Alan Wake", "108710"),
  ]);
  assert.equal(result.matchedShop, "steam");
  assert.equal(result.matchedGameKey, "steam:108710");
  assert.match(result.coverImageUrl, /108710/);
});
test("catalogue enrichment uses exact normalized identity and bounded public requests", async () => {
  globalThis.__metadata.catalogue = async (_route, _query, options) => {
    assert.equal(options.needsAuth, false);
    assert.equal(options.timeout, 4000);
    return [{ shop: "steam", objectId: "99", title: "Alan Wake 2" }];
  };
  const [result] = await service.enrichDetectedSaveGames([
    entry("Alan Wake II"),
  ]);
  assert.equal(result.steamId, "99");
  assert.equal(result.matchedShop, "steam");
});
test("Epic offer is mapped to a catalogue item identity, not the offer ID", async () => {
  globalThis.fetch = async (_url, options) => {
    assert.ok(options.signal);
    const elements = [
      {
        id: "offer",
        namespace: "sandbox",
        title: "Alan Wake 2",
        items: [{ namespace: "sandbox", id: "item" }],
        keyImages: [
          { type: "OfferImageTall", url: "https://example.com/cover.png" },
        ],
      },
    ];
    return {
      ok: true,
      json: async () => ({ data: { Catalog: { searchStore: { elements } } } }),
    };
  };
  const [result] = await service.enrichDetectedSaveGames([
    entry("Alan Wake II"),
  ]);
  assert.equal(result.matchedObjectId, "sandbox:item");
  assert.equal(result.matchedShop, "epic");
  assert.equal(result.coverImageUrl, "https://example.com/cover.png");
});
test("offline providers preserve every detected save as an importable custom fallback", async () => {
  globalThis.__metadata.catalogue = async () => {
    throw Error("offline");
  };
  globalThis.fetch = async () => {
    throw Error("offline");
  };
  const original = [entry("Uncatalogued game"), entry("Another game")];
  const results = await service.enrichDetectedSaveGames(original);
  assert.deepEqual(
    results.map((r) => r.title),
    original.map((r) => r.title)
  );
  assert.ok(results.every((r) => r.matchedShop === "custom"));
});
