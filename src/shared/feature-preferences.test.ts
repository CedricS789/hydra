import test from "node:test";
import assert from "node:assert/strict";
import {
  isClassicsEnabled,
  isHydraAchievementPointsEnabled,
  isTransferGameEnabled,
} from "./feature-preferences.js";

test("isClassicsEnabled defaults to true and respects explicit false", () => {
  assert.equal(isClassicsEnabled(null), true);
  assert.equal(isClassicsEnabled(undefined), true);
  assert.equal(isClassicsEnabled({}), true);
  assert.equal(isClassicsEnabled({ enableClassics: true }), true);
  assert.equal(isClassicsEnabled({ enableClassics: false }), false);
});

test("isTransferGameEnabled defaults to true and respects explicit false", () => {
  assert.equal(isTransferGameEnabled(null), true);
  assert.equal(isTransferGameEnabled(undefined), true);
  assert.equal(isTransferGameEnabled({}), true);
  assert.equal(isTransferGameEnabled({ enableTransferGame: true }), true);
  assert.equal(isTransferGameEnabled({ enableTransferGame: false }), false);
});

test("isHydraAchievementPointsEnabled defaults to false and respects explicit true", () => {
  assert.equal(isHydraAchievementPointsEnabled(null), false);
  assert.equal(isHydraAchievementPointsEnabled(undefined), false);
  assert.equal(isHydraAchievementPointsEnabled({}), false);
  assert.equal(
    isHydraAchievementPointsEnabled({ showHydraAchievementPoints: false }),
    false
  );
  assert.equal(
    isHydraAchievementPointsEnabled({ showHydraAchievementPoints: true }),
    true
  );
});
