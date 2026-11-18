import assert from "node:assert/strict";
import { it } from "node:test";
import {
  runBigPictureLaunch,
  useLaunchRequestsStore,
} from "./launch-requests.store.js";

it("reserves immediately, shares repeated activation, and clears after failure", async () => {
  let reject!: (error: Error) => void;
  let calls = 0;
  const first = runBigPictureLaunch("steam:1", () => {
    calls++;
    return new Promise<void>((_resolve, no) => {
      reject = no;
    });
  });
  assert.equal(useLaunchRequestsStore.getState().pending.has("steam:1"), true);
  assert.equal(
    runBigPictureLaunch("steam:1", async () => {
      calls++;
    }),
    first
  );
  const failure = assert.rejects(first, /failed/);
  await Promise.resolve();
  reject(new Error("failed"));
  await failure;
  assert.equal(calls, 1);
  assert.equal(useLaunchRequestsStore.getState().pending.has("steam:1"), false);
  await runBigPictureLaunch("steam:1", async () => {
    calls++;
  });
  assert.equal(calls, 2);
});
