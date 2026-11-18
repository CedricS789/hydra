import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { resolveManualPlaytimeWarningPreferences } from "./manual-playtime-warning-preferences.js";

describe("manual-playtime-warning-preferences", () => {
  it("defaults both manual playtime warning flags to true", () => {
    for (const input of [null, undefined, {}]) {
      assert.deepEqual(resolveManualPlaytimeWarningPreferences(input), {
        showManualPlaytimeWarningIcon: true,
        showManualPlaytimeWarningText: true,
      });
    }
  });

  it("respects explicit false for each flag independently", () => {
    assert.deepEqual(
      resolveManualPlaytimeWarningPreferences({
        showManualPlaytimeWarningIcon: false,
      }),
      {
        showManualPlaytimeWarningIcon: false,
        showManualPlaytimeWarningText: true,
      }
    );

    assert.deepEqual(
      resolveManualPlaytimeWarningPreferences({
        showManualPlaytimeWarningText: false,
      }),
      {
        showManualPlaytimeWarningIcon: true,
        showManualPlaytimeWarningText: false,
      }
    );

    assert.deepEqual(
      resolveManualPlaytimeWarningPreferences({
        showManualPlaytimeWarningIcon: false,
        showManualPlaytimeWarningText: false,
      }),
      {
        showManualPlaytimeWarningIcon: false,
        showManualPlaytimeWarningText: false,
      }
    );
  });
});
