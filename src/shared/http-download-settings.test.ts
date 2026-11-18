import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  HTTP_DOWNLOAD_DEFAULTS,
  normalizeHttpRangeSizeMb,
  resolveHttpDownloadSettings,
} from "./http-download-settings.js";

describe("http-download-settings", () => {
  it("returns safe defaults when preferences are null or empty", () => {
    assert.deepEqual(resolveHttpDownloadSettings(null), {
      parallelDownloadsEnabled: true,
      parallelConnections: 4,
      rangeSizeBytes: null,
      stallTimeoutMs: 30_000,
      checkpointIntervalMs: 5_000,
      maxRetryAttempts: 10,
    });
    assert.deepEqual(resolveHttpDownloadSettings(HTTP_DOWNLOAD_DEFAULTS), {
      parallelDownloadsEnabled: true,
      parallelConnections: 4,
      rangeSizeBytes: null,
      stallTimeoutMs: 30_000,
      checkpointIntervalMs: 5_000,
      maxRetryAttempts: 10,
    });
  });

  it("clamps numeric values within safe bounds and enforces single connection when parallel is off", () => {
    assert.deepEqual(
      resolveHttpDownloadSettings({
        httpParallelDownloadsEnabled: false,
        httpParallelConnections: 12,
        httpRangeSizeMb: 512,
        httpStallTimeoutSeconds: 2,
        httpCheckpointIntervalSeconds: 99,
        httpMaxRetryAttempts: 1,
      }),
      {
        parallelDownloadsEnabled: false,
        parallelConnections: 1,
        rangeSizeBytes: 256 * 1024 * 1024,
        stallTimeoutMs: 10_000,
        checkpointIntervalMs: 30_000,
        maxRetryAttempts: 3,
      }
    );
  });

  it("normalizes range size MB cleanly", () => {
    assert.equal(normalizeHttpRangeSizeMb(0), 0);
    assert.equal(normalizeHttpRangeSizeMb(-5), 0);
    assert.equal(normalizeHttpRangeSizeMb(4), 8);
    assert.equal(normalizeHttpRangeSizeMb(64), 64);
    assert.equal(normalizeHttpRangeSizeMb(500), 256);
    assert.equal(normalizeHttpRangeSizeMb(Number.NaN), 0);
  });
});
