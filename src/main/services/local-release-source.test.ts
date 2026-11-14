import assert from "node:assert/strict";
import test from "node:test";
import { compareReleaseTrees } from "./local-release-source.js";

test("compares full snapshots including upstream-only and custom-only files", () => {
  const file = (path: string, sha: string) => ({ path, sha, type: "blob" });
  assert.deepEqual(
    compareReleaseTrees(
      [file("same", "1"), file("old", "2"), file("changed", "3")],
      [file("same", "1"), file("new", "4"), file("changed", "5")]
    ),
    [
      {
        path: "changed",
        originalSha: "3",
        modifiedSha: "5",
        status: "modified",
      },
      { path: "new", originalSha: null, modifiedSha: "4", status: "added" },
      { path: "old", originalSha: "2", modifiedSha: null, status: "removed" },
    ]
  );
});
