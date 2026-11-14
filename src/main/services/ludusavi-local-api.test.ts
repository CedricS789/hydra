import assert from "node:assert/strict";
import test from "node:test";
import {
  assertSaveApiSuccess,
  SaveOperationApprovals,
  savePreviewFiles,
} from "./ludusavi-local-api.js";

test("a failed item cannot be reported as successful even without an error string", () => {
  assert.throws(
    () =>
      assertSaveApiSuccess({
        games: {
          Game: { decision: "Processed", files: { save: { failed: true } } },
        },
      }),
    /could not be processed/
  );
  assert.throws(
    () => assertSaveApiSuccess({ errors: { cloudConflict: true } }),
    /errors/
  );
  assert.throws(
    () => assertSaveApiSuccess({ games: { Game: { decision: "Ignored" } } }),
    /not processed/
  );
  assert.doesNotThrow(() =>
    assertSaveApiSuccess({
      errors: {},
      games: { Game: { decision: "Processed" } },
    })
  );
});

test("restore preview includes excluded items rather than pretending they are selected", () => {
  assert.deepEqual(
    savePreviewFiles(
      {
        games: {
          Game: {
            files: {
              excluded: { bytes: 12, ignored: true, change: "Different" },
            },
          },
        },
      },
      "Game"
    ),
    [
      {
        path: "excluded",
        bytes: 12,
        change: "Different",
        ignored: true,
        failed: false,
      },
    ]
  );
});

test("operation approvals are single-use, expire, and reject changed settings", () => {
  const approvals = new SaveOperationApprovals();
  const preview = {
    operation: "restore" as const,
    gameKey: "steam:1",
    title: "Game",
    backup: "version.zip",
    files: [],
    registry: [],
  };
  const context = { destination: "A", config: "original" };
  const first = approvals.issue(preview, context, 100);
  assert.equal(
    approvals.consume(first.token, context, 101).backup,
    "version.zip"
  );
  assert.throws(() => approvals.consume(first.token, context, 102), /expired/);
  const second = approvals.issue(preview, context, 100);
  assert.throws(
    () =>
      approvals.consume(second.token, { ...context, destination: "B" }, 101),
    /settings changed/
  );
  assert.throws(() => approvals.consume(second.token, context, 102), /expired/);
  const third = approvals.issue(preview, context, 100);
  assert.throws(() => approvals.peek(third.token, 300101), /again/);
  assert.throws(
    () => approvals.consume(third.token, context, 300101),
    /expired/
  );
});
