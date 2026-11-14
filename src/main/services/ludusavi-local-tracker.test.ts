import assert from "node:assert/strict";
import test from "node:test";
import { LudusaviExitTracker } from "./ludusavi-local-tracker.js";

const games = [{ key: "steam:1", paths: ["C:\\Games\\Example\\start.exe"] }];
const other = { pid: 1, exe: "C:\\Windows\\explorer.exe", startTime: "1" };
const root = { pid: 10, exe: games[0].paths[0], parentPid: 1, startTime: "10" };
const child = {
  pid: 11,
  exe: "C:\\Games\\Example\\bin\\game.exe",
  parentPid: 10,
  startTime: "11",
};

test("waits for the real child process, then emits exactly one exit", () => {
  const t = new LudusaviExitTracker();
  assert.deepEqual(t.observe(games, [other, root, child], 0, 10), []);
  assert.deepEqual(t.observe(games, [other, child], 20, 10), []);
  assert.deepEqual(t.observe(games, [other], 30, 10), []);
  assert.deepEqual(t.observe(games, [other], 40, 10), ["steam:1"]);
  assert.deepEqual(t.observe(games, [other], 60, 10), []);
});

test("failed scans and a relaunch never trigger a premature backup", () => {
  const t = new LudusaviExitTracker();
  t.observe(games, [other, root], 0, 10);
  assert.deepEqual(t.observe(games, null, 100, 10), []);
  assert.deepEqual(t.observe(games, [], 110, 10), []);
  t.observe(games, [other], 120, 10);
  assert.deepEqual(t.observe(games, [other, root], 130, 10), []);
  assert.deepEqual(t.observe(games, [other, root], 200, 10), []);
});

test("PID reuse does not keep a terminated game alive", () => {
  const t = new LudusaviExitTracker();
  t.observe(games, [other, root], 0, 10);
  const reused = { ...root, exe: "C:\\Other\\unrelated.exe", startTime: "999" };
  t.observe(games, [other, reused], 10, 10);
  assert.deepEqual(t.observe(games, [other, reused], 20, 10), ["steam:1"]);
});
test("PID reuse with no creation timestamp is checked against the captured executable", () => {
  const t = new LudusaviExitTracker();
  t.observe(games, [other, { ...root, startTime: null }], 0, 10);
  const reused = { ...root, exe: "C:\\Other\\unrelated.exe", startTime: null };
  t.observe(games, [other, reused], 10, 10);
  assert.deepEqual(t.observe(games, [other, reused], 20, 10), ["steam:1"]);
});
