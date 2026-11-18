import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  SETTINGS_RESET_GROUPS,
  COMBINED_RESET_GROUPS,
  resetPreferenceDefaults,
  withResetDefaults,
  BACKUP_BEHAVIOR_DEFAULTS,
} from "./settings-reset.js";

describe("reset allowlists and defaults", () => {
  it("keeps protected fields out of every ordinary reset", () => {
    const preserved = [
      "language",
      "downloadsPath",
      "downloadDirectories",
      "screenshotsFolderPath",
      "achievementScreenshotsPath",
      "defaultWinePrefixPath",
      "realDebridApiToken",
      "torBoxApiToken",
      "retroAchievementsWebApiKey",
      "ggDealsApiKey",
      "firstRunGuideCompleted",
      "screenshotDefaultVisibility",
      "showSensitiveScreenshots",
      "disableNsfwAlert",
      "enableAutoInstall",
      "deleteArchiveFilesAfterExtractionByDefault",
    ];
    for (const group of Object.keys(
      SETTINGS_RESET_GROUPS
    ) as (keyof typeof SETTINGS_RESET_GROUPS)[]) {
      for (const field of preserved)
        assert.equal(
          Object.hasOwn(resetPreferenceDefaults(group), field),
          false,
          `${group}: ${field}`
        );
    }
    assert.ok(!COMBINED_RESET_GROUPS.includes("social"));
    assert.equal(
      resetPreferenceDefaults("combined").showFriendsAndChat,
      undefined
    );
    assert.equal(resetPreferenceDefaults("combined").allowDirectTorrent, false);
  });
  it("shares effective UI defaults and never mutates the registry", () => {
    const defaults = withResetDefaults(null);
    for (const group of Object.values(SETTINGS_RESET_GROUPS)) {
      for (const [key, value] of Object.entries(group.defaults))
        assert.deepEqual(defaults[key], value);
    }
    const patch = resetPreferenceDefaults("screenshots");
    patch.screenshotGamepadCombo!.push("a");
    assert.deepEqual(
      resetPreferenceDefaults("screenshots").screenshotGamepadCombo,
      ["back", "ls"]
    );
    assert.equal(
      withResetDefaults({ launchToLibraryPage: true })
        .bigPictureLaunchToLibraryPage,
      true
    );
  });
  it("uses backup-only installation defaults without paths or per-game overrides", () => {
    assert.deepEqual(BACKUP_BEHAVIOR_DEFAULTS, {
      enabled: true,
      fullRetention: 10,
      differentialRetention: 0,
      exitDelaySeconds: 10,
      format: "zip",
      compression: "deflate",
    });
    assert.equal(Object.hasOwn(BACKUP_BEHAVIOR_DEFAULTS, "destination"), false);
    assert.equal(Object.hasOwn(BACKUP_BEHAVIOR_DEFAULTS, "games"), false);
  });
});
