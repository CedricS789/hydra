import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  applyLudusaviResultToSummary,
  backfillBackupSummaryFromVersions,
  classifyBulkBackupOutcome,
} from "./ludusavi-local-summary.ts";
import type { LudusaviLocalResult } from "../../types/local-edition.types.ts";

const makeResult = (
  overrides: Partial<LudusaviLocalResult> = {}
): LudusaviLocalResult => ({
  gameKey: "steam:100",
  title: "Test Game",
  at: "2026-11-15T04:00:00.000Z",
  status: "success",
  files: 4,
  bytes: 2048,
  registryKeys: 1,
  filePaths: ["save1.dat"],
  message: "Backup complete",
  cloudSync: "not-verified",
  ...overrides,
});

describe("ludusavi-local-summary", () => {
  it("records a successful backup timestamp and counts", () => {
    const summary = applyLudusaviResultToSummary(undefined, makeResult());
    assert.deepEqual(summary, {
      lastBackupAt: "2026-11-15T04:00:00.000Z",
      lastAttemptAt: "2026-11-15T04:00:00.000Z",
      lastAttemptStatus: "success",
      lastError: null,
      files: 4,
      bytes: 2048,
      registryKeys: 1,
    });
  });

  it("ignores preview and non-backup operations", () => {
    assert.equal(
      applyLudusaviResultToSummary(
        undefined,
        makeResult({ status: "preview" })
      ),
      null
    );
    assert.equal(
      applyLudusaviResultToSummary(
        undefined,
        makeResult({ operation: "restore" })
      ),
      null
    );
  });

  it("preserves prior lastBackupAt when a subsequent backup fails", () => {
    const initial = applyLudusaviResultToSummary(undefined, makeResult())!;
    const afterFailure = applyLudusaviResultToSummary(
      initial,
      makeResult({
        at: "2026-11-15T05:00:00.000Z",
        status: "failed",
        message: "Game is still running",
      })
    );
    assert.deepEqual(afterFailure, {
      lastBackupAt: "2026-11-15T04:00:00.000Z",
      lastAttemptAt: "2026-11-15T05:00:00.000Z",
      lastAttemptStatus: "failed",
      lastError: "Game is still running",
      files: 4,
      bytes: 2048,
      registryKeys: 1,
    });
  });

  it("backfills newest version timestamp without downgrading newer stored timestamp", () => {
    const backfilled = backfillBackupSummaryFromVersions(undefined, [
      { when: "2026-11-10T10:00:00Z" },
      { when: "2026-11-12T15:30:00Z" },
    ]);
    assert.equal(backfilled?.lastBackupAt, "2026-11-12T15:30:00.000Z");
    assert.equal(backfilled?.lastAttemptStatus, "success");

    const unchanged = backfillBackupSummaryFromVersions(backfilled!, [
      { when: "2026-11-11T00:00:00Z" },
    ]);
    assert.equal(unchanged, null);
  });

  it("classifies bulk outcomes into succeeded, skipped, and failed", () => {
    const skipMessages = [
      "The game or a related executable is still running.",
      "No save files or registry keys were found.",
    ];
    assert.equal(
      classifyBulkBackupOutcome(makeResult(), skipMessages),
      "succeeded"
    );
    assert.equal(
      classifyBulkBackupOutcome(
        makeResult({
          status: "failed",
          message: "No save files or registry keys were found.",
        }),
        skipMessages
      ),
      "skipped"
    );
    assert.equal(
      classifyBulkBackupOutcome(
        makeResult({ status: "failed", message: "Permission denied" }),
        skipMessages
      ),
      "failed"
    );
  });
});
