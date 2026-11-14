import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import test, { type TestContext } from "node:test";
import YAML from "yaml";
import {
  validateSaveVersion,
  confinedSavePath,
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
