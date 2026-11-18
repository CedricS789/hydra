import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import test, { type TestContext } from "node:test";
import YAML from "yaml";
import {
  validateSaveVersion,
  confinedSavePath,
  confinedSafetySnapshotPath,
} from "./ludusavi-local-validation.js";
import { acquireSaveBackupLock } from "./ludusavi-local-lock.js";

const fixture = async (t: TestContext) => {
  const scratch = path.resolve(".tmp", "save-manager-unit-tests");
  await fs.mkdir(scratch, { recursive: true });
  const directory = await fs.mkdtemp(path.join(scratch, "case-"));
  t.after(async () => {
    const remove = async (folder: string) => {
      assert.ok(folder.startsWith(`${scratch}${path.sep}`));
      for (const item of await fs.readdir(folder, { withFileTypes: true })) {
        if (item.isDirectory()) await remove(path.join(folder, item.name));
        else await fs.rm(path.join(folder, item.name));
      }
      await fs.rmdir(folder);
    };
    await remove(directory);
  });
  const game = path.join(directory, "Game");
  await fs.mkdir(game);
  return { directory, game };
};

test("validation checks full and differential entries without accessing live saves", async (t) => {
  const { directory, game } = await fixture(t);
  await fs.writeFile(path.join(game, "full.zip"), "fixture");
  await fs.writeFile(path.join(game, "diff.zip"), "fixture");
  await fs.writeFile(
    path.join(game, "mapping.yaml"),
    YAML.stringify({
      name: "Game",
      drives: { "drive-C": "C:" },
      backups: [
        {
          name: "full.zip",
          files: {
            "C:/Game/kept.save": { size: 4 },
            "C:/Game/removed.save": { size: 4 },
          },
          children: [
            {
              name: "diff.zip",
              files: {
                "C:/Game/removed.save": null,
                "C:/Game/new.save": { size: 3 },
              },
            },
          ],
        },
      ],
    })
  );
  const checked: string[] = [];
  const result = await validateSaveVersion(
    directory,
    game,
    "diff.zip",
    async (file) => {
      checked.push(path.basename(file));
      return new Set(
        file.endsWith("full.zip")
          ? ["drive-C/Game/kept.save", "drive-C/Game/removed.save"]
          : ["drive-C/Game/new.save"]
      );
    }
  );
  assert.deepEqual(result, { files: 2, archives: 2 });
  assert.deepEqual(checked, ["full.zip", "diff.zip"]);
  await assert.rejects(
    validateSaveVersion(directory, game, "diff.zip", async () => new Set()),
    /missing/
  );
});

test("validation accepts registry.reg and legacy registry.yaml in zip and folder backups", async (t) => {
  const { directory, game } = await fixture(t);
  await fs.writeFile(path.join(game, "full.zip"), "fixture");
  await fs.writeFile(path.join(game, "diff-cleared.zip"), "fixture");
  await fs.writeFile(
    path.join(game, "mapping.yaml"),
    YAML.stringify({
      name: "Game",
      drives: { "drive-C": "C:" },
      backups: [
        {
          name: "full.zip",
          files: { "C:/Game/save.dat": { size: 4 } },
          registry: { hash: "0c8086139c2645f067530061114eada1292d75a3" },
          children: [
            {
              name: "diff-cleared.zip",
              files: {},
              registry: { hash: null },
            },
          ],
        },
        {
          name: ".",
          files: { "C:/Game/save.dat": { size: 4 } },
          registry: { hash: "0c8086139c2645f067530061114eada1292d75a3" },
        },
      ],
    })
  );

  // ZIP backup with registry.reg passes
  await assert.doesNotReject(
    validateSaveVersion(
      directory,
      game,
      "full.zip",
      async () => new Set(["drive-C/Game/save.dat", "registry.reg"])
    )
  );

  // ZIP backup with legacy registry.yaml passes
  await assert.doesNotReject(
    validateSaveVersion(
      directory,
      game,
      "full.zip",
      async () => new Set(["drive-C/Game/save.dat", "registry.yaml"])
    )
  );

  // ZIP backup missing registry file fails with descriptive error
  await assert.rejects(
    validateSaveVersion(
      directory,
      game,
      "full.zip",
      async () => new Set(["drive-C/Game/save.dat"])
    ),
    /The saved registry data is missing\./
  );

  // Differential backup with registry.hash = null does not require registry file
  await assert.doesNotReject(
    validateSaveVersion(directory, game, "diff-cleared.zip", async (file) =>
      file.endsWith("full.zip") ? new Set(["drive-C/Game/save.dat"]) : new Set()
    )
  );

  // Simple folder backup checks both file and registry.reg on disk
  await fs.mkdir(path.join(game, "drive-C", "Game"), { recursive: true });
  await fs.writeFile(path.join(game, "drive-C", "Game", "save.dat"), "1234");
  await assert.rejects(
    validateSaveVersion(directory, game, ".", async () => new Set()),
    /The saved registry data is missing\./
  );
  await fs.writeFile(
    path.join(game, "registry.reg"),
    "Windows Registry Editor"
  );
  await assert.doesNotReject(
    validateSaveVersion(directory, game, ".", async () => new Set())
  );
});

test("validation rejects escaping version paths and malformed mappings", async (t) => {
  const { directory, game } = await fixture(t);
  await assert.rejects(confinedSavePath(game, directory), /outside/);
  await fs.writeFile(path.join(game, "mapping.yaml"), "backups: nope");
  await assert.rejects(
    validateSaveVersion(directory, game, "x", async () => new Set()),
    /malformed/
  );
  await fs.writeFile(
    path.join(game, "mapping.yaml"),
    YAML.stringify({ drives: {}, backups: [{ name: "../escape", files: {} }] })
  );
  await assert.rejects(
    validateSaveVersion(directory, game, "../escape", async () => new Set()),
    /Invalid/
  );
});

test("destination locks block overlapping processes and persist the child identity", async (t) => {
  const { directory } = await fixture(t);
  const lock = await acquireSaveBackupLock(directory);
  try {
    await assert.rejects(acquireSaveBackupLock(directory), /running/);
    await lock.child(process.pid);
    const owner = JSON.parse(
      await fs.readFile(path.join(directory, ".hydra-ludusavi.lock"), "utf8")
    );
    assert.equal(owner.childPid, process.pid);
    assert.equal(owner.pid, process.pid);
  } finally {
    await lock.release();
  }
  const next = await acquireSaveBackupLock(directory);
  await next.release();
  await assert.rejects(fs.stat(path.join(directory, ".hydra-ludusavi.lock")), {
    code: "ENOENT",
  });
});

test("safety snapshot path confinement allows valid snapshot IDs and rejects traversal", async (t) => {
  const { directory } = await fixture(t);
  const safetyRoot = path.join(directory, ".hydra-restore-safety");
  const validId = "d5ce8127-301a-418d-8eb2-4315fedf4ebf";
  const snapshotDir = path.join(safetyRoot, validId);
  await fs.mkdir(snapshotDir, { recursive: true });
  const resolved = await confinedSafetySnapshotPath(directory, validId);
  assert.equal(resolved, await fs.realpath(snapshotDir));

  for (const badId of ["", ".", "..", "../Game", "a/b", "a\\b"]) {
    await assert.rejects(
      confinedSafetySnapshotPath(directory, badId),
      /Invalid safety snapshot identifier/
    );
  }
  await assert.rejects(
    confinedSafetySnapshotPath(
      directory,
      "00000000-0000-0000-0000-000000000000"
    ),
    /no longer available/
  );
});
