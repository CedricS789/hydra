import assert from "node:assert/strict";
import { test } from "node:test";
import { saveManagerError } from "./save-manager-errors.js";

test("remote setup errors survive Electron IPC wrapping", () => {
  const result = saveManagerError(
    new Error(
      "Error invoking remote method 'previewSaveCloudTransfer': Error: SAVE_REMOTE_NOT_CONFIGURED: Configure a remote."
    )
  );
  assert.equal(result.remoteSetupRequired, true);
  assert.equal(
    result.message,
    "SAVE_REMOTE_NOT_CONFIGURED: Configure a remote."
  );
});

test("other errors keep their useful message and are not classified as missing setup", () => {
  assert.deepEqual(
    saveManagerError(
      "Error: Error invoking remote method 'previewSaveCloudTransfer': Error: Access denied to D:/Backups"
    ),
    {
      message: "Access denied to D:/Backups",
      remoteSetupRequired: false,
    }
  );
});
