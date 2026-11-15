import test from "node:test";
import assert from "node:assert/strict";
import {
  isClassicsEnabled,
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
