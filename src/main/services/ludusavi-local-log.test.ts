import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import test, { type TestContext } from "node:test";
import {
  appendLudusaviBackupLog,
  clearLudusaviBackupLogs,
  LUDUSAVI_LOG_MAX_BYTES,
} from "./ludusavi-local-log.js";

const fixture = async (t: TestContext) => {
  const scratch = path.resolve(".tmp", "ludusavi-log-tests");
  await fs.mkdir(scratch, { recursive: true });
  const directory = await fs.mkdtemp(path.join(scratch, "logs-"));
  t.after(async () => {
    for (const entry of await fs.readdir(directory))
      await fs.rm(path.join(directory, entry));
    await fs.rmdir(directory);
  });
  return directory;
};

test("clearing removes only the two backup logs and is safe to repeat", async (t) => {
  const directory = await fixture(t);
  const untouched = ["config.yaml", "backup.zip", "data.save", "other.log"];
  for (const name of ["backup.log", "backup.log.old", ...untouched])
    await fs.writeFile(path.join(directory, name), name);
  await clearLudusaviBackupLogs(directory);
  await clearLudusaviBackupLogs(directory);
  assert.deepEqual((await fs.readdir(directory)).sort(), untouched.sort());
  for (const name of untouched)
    assert.equal(await fs.readFile(path.join(directory, name), "utf8"), name);
  await assert.doesNotReject(
    clearLudusaviBackupLogs(path.join(directory, "missing"))
  );
});

test("rotation replaces an older log repeatedly and keeps each file within its cap", async (t) => {
  const directory = await fixture(t);
  const entry = { files: ["x".repeat(LUDUSAVI_LOG_MAX_BYTES - 100)] };
  for (let index = 0; index < 4; index++) {
    await appendLudusaviBackupLog(directory, { ...entry, index });
    for (const name of await fs.readdir(directory))
      assert.ok(
        (await fs.stat(path.join(directory, name))).size <=
          LUDUSAVI_LOG_MAX_BYTES
      );
  }
  assert.deepEqual((await fs.readdir(directory)).sort(), [
    "backup.log",
    "backup.log.old",
  ]);
  const current = JSON.parse(
    await fs.readFile(path.join(directory, "backup.log"), "utf8")
  );
  const previous = JSON.parse(
    await fs.readFile(path.join(directory, "backup.log.old"), "utf8")
  );
  assert.equal(current.index, 3);
  assert.equal(previous.index, 2);
});

test("an oversized entry is recorded as bounded valid JSON", async (t) => {
  const directory = await fixture(t);
  await appendLudusaviBackupLog(directory, {
    files: ["💾".repeat(LUDUSAVI_LOG_MAX_BYTES)],
  });
  const log = await fs.readFile(path.join(directory, "backup.log"), "utf8");
  assert.ok(Buffer.byteLength(log) <= LUDUSAVI_LOG_MAX_BYTES);
  assert.equal(JSON.parse(log).truncated, true);
});

test("oversized legacy logs are bounded on the next write", async (t) => {
  const directory = await fixture(t);
  for (const name of ["backup.log", "backup.log.old"])
    await fs.writeFile(
      path.join(directory, name),
      "x".repeat(LUDUSAVI_LOG_MAX_BYTES + 1)
    );
  await appendLudusaviBackupLog(directory, { message: "new result" });
  assert.deepEqual(await fs.readdir(directory), ["backup.log"]);
  assert.equal(
    JSON.parse(await fs.readFile(path.join(directory, "backup.log"), "utf8"))
      .message,
    "new result"
  );
});

test("cleanup reports an invalid log target without deleting its contents", async (t) => {
  const directory = await fixture(t);
  const unexpectedDirectory = path.join(directory, "backup.log");
  await fs.mkdir(unexpectedDirectory);
  await fs.writeFile(path.join(unexpectedDirectory, "data.save"), "keep");
  try {
    await assert.rejects(clearLudusaviBackupLogs(directory));
    assert.equal(
      await fs.readFile(path.join(unexpectedDirectory, "data.save"), "utf8"),
      "keep"
    );
  } finally {
    await fs.rm(path.join(unexpectedDirectory, "data.save"));
    await fs.rmdir(unexpectedDirectory);
  }
});
