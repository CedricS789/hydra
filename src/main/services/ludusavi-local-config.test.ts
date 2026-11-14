import assert from "node:assert/strict";
import test from "node:test";
import {
  managedSaveConfig,
  parseSaveEngineConfig,
} from "./ludusavi-local-config.js";

test("advanced rules survive managed configuration while implicit remote sync stays disabled", () => {
  const base = {
    roots: [{ path: "D:/Games", store: "steam" }],
    redirects: [{ kind: "restore", source: "C:/old", target: "C:/new" }],
    customGames: [
      {
        name: "Custom",
        registry: ["HKEY_CURRENT_USER/Software/Custom"],
        integration: "override",
      },
    ],
    backup: {
      path: "wrong",
      filter: { ignoredPaths: ["C:/exclude"] },
      format: { compression: { zstd: { level: 10 } } },
    },
    cloud: { remote: { Custom: { id: "private-remote" } }, synchronize: true },
  };
  const result = managedSaveConfig(base, {
    enabled: false,
    destination: "D:/Backups",
    fullRetention: 8,
    differentialRetention: 3,
    format: "zip",
    compression: "zstd",
    exitDelaySeconds: 10,
    games: {},
  });
  assert.equal(result.backup?.path, "D:/Backups");
  assert.deepEqual(result.backup?.retention, { full: 8, differential: 3 });
  assert.deepEqual(result.backup?.filter, base.backup.filter);
  assert.deepEqual(result.customGames, base.customGames);
  assert.deepEqual(result.redirects, base.redirects);
  assert.equal(result.restore?.path, "D:/Backups");
  assert.equal(result.cloud?.synchronize, false);
  assert.deepEqual(result.cloud?.remote, base.cloud.remote);
  assert.equal(base.cloud.synchronize, true);
  assert.equal(
    (result.backup?.format as typeof base.backup.format).compression.zstd.level,
    10
  );
});

test("older settings retain ZIP and full-only backup defaults", () => {
  const result = managedSaveConfig(
    {},
    {
      enabled: false,
      destination: "D:/Backups",
      fullRetention: 10,
      exitDelaySeconds: 10,
      games: {},
    }
  );
  assert.deepEqual(result.backup?.retention, { full: 10, differential: 0 });
  assert.equal((result.backup?.format as { chosen: string }).chosen, "zip");
});

test("advanced configuration rejects non-mappings, malformed YAML, and oversized input", () => {
  assert.throws(() => parseSaveEngineConfig("- one\n- two"), /mapping/);
  assert.throws(() => parseSaveEngineConfig("roots: ["));
  assert.throws(
    () => parseSaveEngineConfig("x".repeat(1024 * 1024 + 1)),
    /smaller/
  );
  assert.deepEqual(parseSaveEngineConfig("roots: []"), { roots: [] });
});
