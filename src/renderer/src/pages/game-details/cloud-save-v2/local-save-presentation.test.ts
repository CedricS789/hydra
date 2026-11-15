import assert from "node:assert/strict";
import { describe, it } from "node:test";

// @ts-ignore The Node ESM test runner requires the source extension.
import { getLocalSavePresentation } from "./local-save-presentation.ts";

describe("local-save-presentation", () => {
  it("prioritizes active backing-up state", () => {
    const result = getLocalSavePresentation({
      globalEnabled: true,
      gameEnabled: true,
      hasExecutablePath: true,
      isBackingUp: true,
      summary: {
        lastBackupAt: "2026-11-15T04:00:00.000Z",
        lastAttemptAt: "2026-11-15T04:00:00.000Z",
        lastAttemptStatus: "success",
        lastError: null,
        files: 3,
        bytes: 1024,
        registryKeys: 0,
      },
    });
    assert.equal(result.kind, "backing-up");
    assert.equal(result.icon, "spinner");
  });

  it("shows failed state while keeping prior backup timestamp", () => {
    const result = getLocalSavePresentation({
      globalEnabled: true,
      gameEnabled: true,
      hasExecutablePath: true,
      isBackingUp: false,
      summary: {
        lastBackupAt: "2026-11-15T04:00:00.000Z",
        lastAttemptAt: "2026-11-15T05:00:00.000Z",
        lastAttemptStatus: "failed",
        lastError: "Disk full",
        files: 3,
        bytes: 1024,
        registryKeys: 0,
      },
    });
    assert.equal(result.kind, "failed");
    assert.equal(result.tone, "conflict");
    assert.equal(result.lastBackupAt, "2026-11-15T04:00:00.000Z");
    assert.equal(result.lastError, "Disk full");
  });

  it("shows backed-up state when a valid backup exists", () => {
    const result = getLocalSavePresentation({
      globalEnabled: false,
      gameEnabled: false,
      hasExecutablePath: false,
      isBackingUp: false,
      summary: {
        lastBackupAt: "2026-11-15T04:00:00.000Z",
        lastAttemptAt: "2026-11-15T04:00:00.000Z",
        lastAttemptStatus: "success",
        lastError: null,
        files: 2,
        bytes: 512,
        registryKeys: 0,
      },
    });
    assert.equal(result.kind, "backed-up");
    assert.equal(result.tone, "synced");
    assert.equal(result.icon, "synced");
  });

  it("distinguishes disabled, no-executable, and ready when no backups exist", () => {
    assert.equal(
      getLocalSavePresentation({
        globalEnabled: false,
        gameEnabled: true,
        hasExecutablePath: true,
        isBackingUp: false,
      }).kind,
      "disabled"
    );
    assert.equal(
      getLocalSavePresentation({
        globalEnabled: true,
        gameEnabled: true,
        hasExecutablePath: false,
        isBackingUp: false,
      }).kind,
      "no-executable"
    );
    assert.equal(
      getLocalSavePresentation({
        globalEnabled: true,
        gameEnabled: true,
        hasExecutablePath: true,
        isBackingUp: false,
      }).kind,
      "ready"
    );
  });
});
