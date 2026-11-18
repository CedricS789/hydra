import assert from "node:assert/strict";
import { it } from "node:test";
import { observeLatestSnapshot } from "./observe-latest-snapshot.js";

it("a delayed initial process snapshot cannot undo a newer running-game event", async () => {
  let emit!: (value: string[]) => void;
  let resolve!: (value: string[]) => void;
  const applied: string[][] = [];
  let removed = false;
  const stop = observeLatestSnapshot<string[]>(
    (listener) => {
      emit = listener;
      return () => {
        removed = true;
      };
    },
    () =>
      new Promise((yes) => {
        resolve = yes;
      }),
    (value) => applied.push(value)
  );
  emit(["steam:1"]);
  resolve([]);
  await Promise.resolve();
  assert.deepEqual(applied, [["steam:1"]]);
  stop();
  emit([]);
  assert.equal(removed, true);
  assert.deepEqual(applied, [["steam:1"]]);
});
it("applies the initial snapshot when there is no event, and ignores reads after disposal", async () => {
  const applied: number[] = [];
  observeLatestSnapshot<number>(
    () => () => {},
    async () => 1,
    (value) => applied.push(value)
  );
  const stop = observeLatestSnapshot<number>(
    () => () => {},
    async () => 2,
    (value) => applied.push(value)
  );
  stop();
  await Promise.resolve();
  assert.deepEqual(applied, [1]);
});
