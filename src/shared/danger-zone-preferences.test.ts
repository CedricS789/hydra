import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  areAllDangerZonePreferencesDisabled,
  areAllDangerZonePreferencesEnabled,
  buildDisableAllDangerZonePreferencesPatch,
  buildEnableAllDangerZonePreferencesPatch,
  hasAnyDangerZoneActionEnabled,
  isDangerZoneTabVisible,
  resolveDangerZonePreferences,
} from "./danger-zone-preferences.js";

describe("danger-zone-preferences", () => {
  it("defaults every Danger Zone preference to true", () => {
    for (const input of [null, undefined, {}]) {
      const resolved = resolveDangerZonePreferences(input);
      assert.deepEqual(resolved, {
        enableDangerZone: true,
        enableDangerZoneChangePlaytime: true,
        enableDangerZoneResetPlaytime: true,
        enableDangerZoneResetAchievements: true,
        enableDangerZoneRemoveGameFiles: true,
        enableDangerZoneRemoveFromLibrary: true,
        enableDangerZoneDeleteScreenshots: true,
      });
      assert.equal(areAllDangerZonePreferencesEnabled(resolved), true);
      assert.equal(areAllDangerZonePreferencesDisabled(resolved), false);
    }
  });

  it("respects explicit false for each individual preference", () => {
    const resolved = resolveDangerZonePreferences({
      enableDangerZone: false,
      enableDangerZoneChangePlaytime: false,
      enableDangerZoneResetPlaytime: false,
      enableDangerZoneResetAchievements: false,
      enableDangerZoneRemoveGameFiles: false,
      enableDangerZoneRemoveFromLibrary: false,
      enableDangerZoneDeleteScreenshots: false,
    });
    assert.deepEqual(resolved, {
      enableDangerZone: false,
      enableDangerZoneChangePlaytime: false,
      enableDangerZoneResetPlaytime: false,
      enableDangerZoneResetAchievements: false,
      enableDangerZoneRemoveGameFiles: false,
      enableDangerZoneRemoveFromLibrary: false,
      enableDangerZoneDeleteScreenshots: false,
    });
    assert.equal(areAllDangerZonePreferencesDisabled(resolved), true);
    assert.equal(areAllDangerZonePreferencesEnabled(resolved), false);
  });

  it("builds disable-all and enable-all patches", () => {
    const disabled = resolveDangerZonePreferences(
      buildDisableAllDangerZonePreferencesPatch()
    );
    assert.equal(areAllDangerZonePreferencesDisabled(disabled), true);

    const enabled = resolveDangerZonePreferences(
      buildEnableAllDangerZonePreferencesPatch()
    );
    assert.equal(areAllDangerZonePreferencesEnabled(enabled), true);
  });

  it("computes tab visibility across master toggle, custom games, screenshots feature, and Big Picture", () => {
    assert.equal(isDangerZoneTabVisible({ enableDangerZone: false }), false);

    const onlyCustomHiddenActions = {
      enableDangerZone: true,
      enableDangerZoneChangePlaytime: false,
      enableDangerZoneResetPlaytime: false,
      enableDangerZoneResetAchievements: true,
      enableDangerZoneRemoveGameFiles: true,
      enableDangerZoneRemoveFromLibrary: false,
      enableDangerZoneDeleteScreenshots: false,
    };
    assert.equal(
      isDangerZoneTabVisible(onlyCustomHiddenActions, { isCustomGame: false }),
      true
    );
    assert.equal(
      isDangerZoneTabVisible(onlyCustomHiddenActions, { isCustomGame: true }),
      false
    );

    const onlyScreenshots = {
      enableDangerZone: true,
      enableDangerZoneChangePlaytime: false,
      enableDangerZoneResetPlaytime: false,
      enableDangerZoneResetAchievements: false,
      enableDangerZoneRemoveGameFiles: false,
      enableDangerZoneRemoveFromLibrary: false,
      enableDangerZoneDeleteScreenshots: true,
    };
    assert.equal(
      isDangerZoneTabVisible(onlyScreenshots, {
        screenshotsFeatureEnabled: true,
      }),
      true
    );
    assert.equal(
      isDangerZoneTabVisible(onlyScreenshots, {
        screenshotsFeatureEnabled: false,
      }),
      false
    );

    const onlyPlaytime = {
      enableDangerZone: true,
      enableDangerZoneChangePlaytime: true,
      enableDangerZoneResetPlaytime: true,
      enableDangerZoneResetAchievements: false,
      enableDangerZoneRemoveGameFiles: false,
      enableDangerZoneRemoveFromLibrary: false,
      enableDangerZoneDeleteScreenshots: false,
    };
    assert.equal(
      isDangerZoneTabVisible(onlyPlaytime, { includePlaytimeActions: true }),
      true
    );
    assert.equal(
      isDangerZoneTabVisible(onlyPlaytime, { includePlaytimeActions: false }),
      false
    );

    assert.equal(
      hasAnyDangerZoneActionEnabled(
        resolveDangerZonePreferences({
          enableDangerZoneChangePlaytime: false,
          enableDangerZoneResetPlaytime: false,
          enableDangerZoneResetAchievements: false,
          enableDangerZoneRemoveGameFiles: false,
          enableDangerZoneRemoveFromLibrary: false,
          enableDangerZoneDeleteScreenshots: false,
        })
      ),
      false
    );
  });
});
