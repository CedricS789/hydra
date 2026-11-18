import assert from "node:assert/strict";
import { it } from "node:test";
import type { LudusaviLocalSettings } from "@types";
import { withGameBackupEnabled } from "./backup-settings-draft.js";

it("undoing a default-on game's toggle restores the exact original settings", () => {
  const baseline = { games: {} } as LudusaviLocalSettings;
  const disabled = withGameBackupEnabled(baseline, baseline, "steam:1", false);
  assert.equal(disabled.games["steam:1"].enabled, false);
  assert.deepEqual(
    withGameBackupEnabled(disabled, baseline, "steam:1", true),
    baseline
  );
  assert.deepEqual(baseline.games, {});
});
it("preserves custom rules and baseline-disabled games when toggling", () => {
  const baseline = {
    games: {
      "steam:1": {
        enabled: false,
        savePaths: ["C:/saves"],
        trackingPaths: [],
        manifestTitle: "Game",
      },
    },
  } as unknown as LudusaviLocalSettings;
  const enabled = withGameBackupEnabled(baseline, baseline, "steam:1", true);
  assert.equal(enabled.games["steam:1"].manifestTitle, "Game");
  assert.deepEqual(
    withGameBackupEnabled(enabled, baseline, "steam:1", false),
    baseline
  );
});
