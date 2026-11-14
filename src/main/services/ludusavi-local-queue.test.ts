import assert from "node:assert/strict";
import test from "node:test";
import { LudusaviBackupQueue } from "./ludusavi-local-queue.js";

test("deduplicates queued games and serializes different games after a failure", async () => {
  const queue = new LudusaviBackupQueue();
  const calls: string[] = [];
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const first = queue.enqueue("a", async () => {
    calls.push("a");
    await gate;
    throw new Error("disk unavailable");
  });
  assert.equal(
    queue.enqueue("a", async () => {
      throw new Error("duplicate ran");
    }),
    first
  );
  const second = queue.enqueue("b", async () => {
    calls.push("b");
    return "done";
  });
  await Promise.resolve();
  await Promise.resolve();
  assert.deepEqual(calls, ["a"]);
  assert.equal(queue.busy, true);
  release();
  await assert.rejects(first, /disk unavailable/);
  assert.equal(await second, "done");
  assert.deepEqual(calls, ["a", "b"]);
  assert.equal(queue.busy, false);
});
