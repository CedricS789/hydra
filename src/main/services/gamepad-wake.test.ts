import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  BIG_PICTURE_WAKE_COOLDOWN_MS,
  canTriggerBigPictureWake,
  resolveControllerLedMode,
  toBigPictureGamepadWakeStatus,
} from "./gamepad-wake-policy.js";

describe("Big Picture gamepad wake policy", () => {
  it("allows wake only when enabled, idle, unfocused, and outside cooldown", () => {
    assert.equal(
      canTriggerBigPictureWake({
        enabled: true,
        gamesRunning: false,
        bigPictureFocused: false,
        now: 2_000,
        lastTriggeredAt: null,
      }),
      true
    );

    assert.equal(
      canTriggerBigPictureWake({
        enabled: false,
        gamesRunning: false,
        bigPictureFocused: false,
        now: 2_000,
        lastTriggeredAt: null,
      }),
      false
    );

    assert.equal(
      canTriggerBigPictureWake({
        enabled: true,
        gamesRunning: true,
        bigPictureFocused: false,
        now: 2_000,
        lastTriggeredAt: null,
      }),
      false
    );

    assert.equal(
      canTriggerBigPictureWake({
        enabled: true,
        gamesRunning: false,
        bigPictureFocused: true,
        now: 2_000,
        lastTriggeredAt: null,
      }),
      false
    );

    assert.equal(
      canTriggerBigPictureWake({
        enabled: true,
        gamesRunning: false,
        bigPictureFocused: false,
        now: 2_000 + BIG_PICTURE_WAKE_COOLDOWN_MS - 1,
        lastTriggeredAt: 2_000,
      }),
      false
    );

    assert.equal(
      canTriggerBigPictureWake({
        enabled: true,
        gamesRunning: false,
        bigPictureFocused: false,
        now: 2_000 + BIG_PICTURE_WAKE_COOLDOWN_MS,
        lastTriggeredAt: 2_000,
      }),
      true
    );
  });

  it("maps native status and unavailable hints cleanly", () => {
    assert.deepEqual(
      toBigPictureGamepadWakeStatus(
        { gamepadBackend: "xinput", gamepadError: null },
        true,
        true
      ),
      {
        active: true,
        gamepadBackend: "xinput",
        hint: null,
      }
    );

    assert.deepEqual(
      toBigPictureGamepadWakeStatus(
        { gamepadBackend: "evdev", gamepadError: "gamepad-no-access" },
        true,
        true
      ),
      {
        active: true,
        gamepadBackend: "evdev",
        hint: "gamepad_unavailable",
      }
    );

    assert.deepEqual(
      toBigPictureGamepadWakeStatus(
        { gamepadBackend: "unavailable", gamepadError: null },
        false,
        false
      ),
      {
        active: false,
        gamepadBackend: "unavailable",
        hint: null,
      }
    );
  });

  it("resolves PlayStation controller LED state cleanly across idle, Big Picture, and in-game", () => {
    assert.equal(
      resolveControllerLedMode({
        enabled: true,
        gamesRunning: false,
        bigPictureOpen: false,
      }),
      "idle"
    );
    assert.equal(
      resolveControllerLedMode({
        enabled: true,
        gamesRunning: false,
        bigPictureOpen: true,
      }),
      "active"
    );
    assert.equal(
      resolveControllerLedMode({
        enabled: true,
        gamesRunning: true,
        bigPictureOpen: true,
      }),
      "paused"
    );
    assert.equal(
      resolveControllerLedMode({
        enabled: false,
        gamesRunning: false,
        bigPictureOpen: true,
      }),
      "off"
    );
  });
});
