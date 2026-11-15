import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  dedupeBulkLibraryRemovalTargets,
  formatBulkLibraryRemovalConfirmation,
  getBulkLibraryRemovalBlockReason,
  validateBulkLibraryRemovalConfirmation,
} from "./bulk-library-removal.js";

describe("bulk-library-removal", () => {
  it("formats confirmation phrases for positive integer counts", () => {
    assert.equal(formatBulkLibraryRemovalConfirmation(0), "");
    assert.equal(formatBulkLibraryRemovalConfirmation(-2), "");
    assert.equal(formatBulkLibraryRemovalConfirmation(1), "REMOVE 1");
    assert.equal(formatBulkLibraryRemovalConfirmation(12), "REMOVE 12");
  });

  it("deduplicates targets while preserving order", () => {
    assert.deepEqual(
      dedupeBulkLibraryRemovalTargets([
        { shop: "steam", objectId: "100" },
        { shop: "epic", objectId: "200" },
        { shop: "steam", objectId: "100" },
        { shop: "custom", objectId: "" },
      ]),
      [
        { shop: "steam", objectId: "100" },
        { shop: "epic", objectId: "200" },
      ]
    );
  });

  it("enforces exact confirmation phrase and non-empty selection", () => {
    assert.throws(() => validateBulkLibraryRemovalConfirmation(0, "REMOVE 0"));
    assert.throws(() => validateBulkLibraryRemovalConfirmation(3, undefined));
    assert.throws(() => validateBulkLibraryRemovalConfirmation(3, "remove 3"));
    assert.throws(() => validateBulkLibraryRemovalConfirmation(3, "REMOVE 2"));
    assert.doesNotThrow(() =>
      validateBulkLibraryRemovalConfirmation(3, "REMOVE 3")
    );
  });

  it("classifies block reasons with running prioritized over downloading", () => {
    assert.equal(
      getBulkLibraryRemovalBlockReason({
        isRunning: true,
        isDownloading: true,
      }),
      "running"
    );
    assert.equal(
      getBulkLibraryRemovalBlockReason({
        isRunning: false,
        isDownloading: true,
      }),
      "downloading"
    );
    assert.equal(
      getBulkLibraryRemovalBlockReason({
        isRunning: false,
        isDownloading: false,
      }),
      null
    );
  });
});
