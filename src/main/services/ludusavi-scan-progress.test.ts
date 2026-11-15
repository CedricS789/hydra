import assert from "node:assert/strict";
import { test } from "node:test";
import fs from "node:fs/promises";
import path from "node:path";
import { SaveScanProgress, monitorSaveScan } from "./ludusavi-scan-progress.ts";

test("parallel scan IDs do not masquerade as completed percentages", () => {
  const parser = new SaveScanProgress();
  const line = (value: string) =>
    parser.line(`[time] TRACE [ludusavi::cli] ${value}`)!;
  assert.equal(line("step 99 / 100: Last title").completed, 0);
  assert.deepEqual(line("step 0 / 100: First title").currentTitles, [
    "Last title",
    "First title",
  ]);
  assert.equal(line("step 99 completed").completed, 1);
  const excluded = line("[First title] excluded by backup filter");
  assert.equal(excluded.completed, 2);
  assert.deepEqual(excluded.currentTitles, []);
  assert.equal(line("step 99 completed").completed, 2);
  assert.equal(parser.line("Unrelated CLI output"), undefined);
});

test("log monitoring removes only newly created scan logs", async () => {
  await fs.mkdir(path.join(process.cwd(), ".tmp"), { recursive: true });
  const root = await fs.mkdtemp(
    path.join(process.cwd(), ".tmp", "scan-log-test-")
  );
  await fs.writeFile(
    path.join(root, "ludusavi_existing.log"),
    "keep existing history\n"
  );
  const seen: unknown[] = [];
  const stop = await monitorSaveScan(root, (value) => seen.push(value));
  await fs.writeFile(
    path.join(root, "ludusavi_scan.log"),
    "[now] TRACE [ludusavi::cli] step 0 / 1: Example\n[now] TRACE [ludusavi::cli] step 0 completed\n"
  );
  await stop();
  assert.equal(seen.length, 2);
  assert.equal(
    await fs.readFile(path.join(root, "ludusavi_existing.log"), "utf8"),
    "keep existing history\n"
  );
  await assert.rejects(fs.stat(path.join(root, "ludusavi_scan.log")), {
    code: "ENOENT",
  });
});
