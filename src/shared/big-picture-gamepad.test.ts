import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  addControllerLedCustomColor,
  computeControllerLedIdleHex,
  DEFAULT_BIG_PICTURE_CONTROLLER_LED_COLOR,
  DEFAULT_BIG_PICTURE_GAME_WINDOW_MODE,
  DEFAULT_BIG_PICTURE_GAMEPAD_WAKE_COMBO,
  DEFAULT_BIG_PICTURE_GAMEPAD_WAKE_HOLD_MS,
  findControllerLedPreset,
  MAX_BIG_PICTURE_CONTROLLER_LED_CUSTOM_COLORS,
  normalizeBigPictureGameWindowMode,
  normalizeControllerLedColor,
  normalizeControllerLedCustomColors,
  removeControllerLedCustomColor,
  resolveBigPictureGamepadWakeSettings,
  resolveBigPictureHomeNavigationTarget,
  toNativeBigPictureWakeConfig,
} from "./big-picture-gamepad.js";

describe("Big Picture gamepad wake shared preferences", () => {
  it("resolves sensible defaults when preferences are missing or invalid", () => {
    const resolved = resolveBigPictureGamepadWakeSettings(null);
    assert.equal(resolved.enabled, true);
    assert.equal(resolved.mode, "home-hold");
    assert.deepEqual(resolved.combo, [
      ...DEFAULT_BIG_PICTURE_GAMEPAD_WAKE_COMBO,
    ]);
    assert.equal(resolved.homeButtonAction, "power-menu");

    const invalid = resolveBigPictureGamepadWakeSettings({
      bigPictureGamepadWakeMode: "unknown" as never,
      bigPictureHomeButtonAction: "invalid" as never,
      bigPictureGamepadWakeCombo: [],
    });
    assert.equal(invalid.mode, "home-hold");
    assert.equal(invalid.homeButtonAction, "power-menu");
    assert.deepEqual(invalid.combo, ["back", "start"]);
    assert.equal(
      invalid.controllerLedColor,
      DEFAULT_BIG_PICTURE_CONTROLLER_LED_COLOR
    );

    for (const action of [
      "home",
      "library",
      "catalogue",
      "downloads",
      "profile",
      "settings",
      "power-menu",
    ] as const) {
      assert.equal(
        resolveBigPictureGamepadWakeSettings({
          bigPictureHomeButtonAction: action,
        }).homeButtonAction,
        action
      );
    }
  });

  it("resolves Big Picture Home button navigation targets across pages", () => {
    assert.equal(
      resolveBigPictureHomeNavigationTarget("power-menu", "/big-picture", true),
      null
    );
    assert.equal(
      resolveBigPictureHomeNavigationTarget("library", "/big-picture", true),
      "/big-picture/library"
    );
    assert.equal(
      resolveBigPictureHomeNavigationTarget(
        "library",
        "/big-picture/library/",
        true
      ),
      null
    );
    assert.equal(
      resolveBigPictureHomeNavigationTarget(
        "home",
        "/big-picture/settings",
        true
      ),
      "/big-picture"
    );
    assert.equal(
      resolveBigPictureHomeNavigationTarget("downloads", "/library", false),
      "/downloads"
    );
    assert.equal(
      resolveBigPictureHomeNavigationTarget(
        "profile",
        "/big-picture/profile/user-1",
        true
      ),
      null
    );
    assert.equal(
      resolveBigPictureHomeNavigationTarget(
        "catalogue",
        "/big-picture/game/steam/123",
        true
      ),
      "/big-picture/catalogue"
    );
  });

  it("maps wake modes to native addon configuration", () => {
    assert.deepEqual(
      toNativeBigPictureWakeConfig({
        enabled: true,
        mode: "home-hold",
        combo: ["back", "start"],
      }),
      {
        wakeEnabled: true,
        wakeMode: "hold",
        wakeButtons: ["home"],
        wakeHoldMs: DEFAULT_BIG_PICTURE_GAMEPAD_WAKE_HOLD_MS,
      }
    );

    assert.deepEqual(
      toNativeBigPictureWakeConfig({
        enabled: true,
        mode: "home-press",
        combo: ["back", "start"],
      }),
      {
        wakeEnabled: true,
        wakeMode: "press",
        wakeButtons: ["home"],
        wakeHoldMs: 0,
      }
    );

    assert.deepEqual(
      toNativeBigPictureWakeConfig({
        enabled: true,
        mode: "combo",
        combo: ["lb", "rb"],
      }),
      {
        wakeEnabled: true,
        wakeMode: "press",
        wakeButtons: ["lb", "rb"],
        wakeHoldMs: 0,
      }
    );

    assert.deepEqual(
      toNativeBigPictureWakeConfig({
        enabled: false,
        mode: "home-hold",
        combo: ["back", "start"],
      }),
      {
        wakeEnabled: false,
        wakeMode: "press",
        wakeButtons: [],
        wakeHoldMs: 0,
      }
    );
  });

  it("normalizes PlayStation LED presets and custom hex colors", () => {
    assert.equal(normalizeControllerLedColor("  #0022FF "), "#0022ff");
    assert.equal(normalizeControllerLedColor("ff4d6d"), "#ff4d6d");
    assert.equal(
      normalizeControllerLedColor("invalid"),
      DEFAULT_BIG_PICTURE_CONTROLLER_LED_COLOR
    );
    assert.equal(findControllerLedPreset("#0022FF")?.id, "ps-blue");
    assert.equal(findControllerLedPreset("#123456"), null);
    assert.equal(computeControllerLedIdleHex("#0022ff"), "#000947");
    assert.equal(computeControllerLedIdleHex("#ff4d6d"), "#47151e");

    assert.deepEqual(
      normalizeControllerLedCustomColors([
        " #ff6b35 ",
        "#0022ff",
        "invalid",
        "#FF6B35",
        "#7B61FF",
      ]),
      ["#ff6b35", "#7b61ff"]
    );
    const added = addControllerLedCustomColor(["#ff6b35"], "#7B61FF");
    assert.deepEqual(added, ["#ff6b35", "#7b61ff"]);
    assert.deepEqual(addControllerLedCustomColor(added, "#0022ff"), [
      "#ff6b35",
      "#7b61ff",
    ]);
    assert.deepEqual(removeControllerLedCustomColor(added, "#ff6b35"), [
      "#7b61ff",
    ]);

    const capped = Array.from(
      { length: MAX_BIG_PICTURE_CONTROLLER_LED_CUSTOM_COLORS + 2 },
      (_, i) => `#10203${i}`
    );
    assert.equal(
      normalizeControllerLedCustomColors(capped).length,
      MAX_BIG_PICTURE_CONTROLLER_LED_CUSTOM_COLORS
    );
  });

  it("normalizes Big Picture game window mode with keep-open as default", () => {
    assert.equal(
      normalizeBigPictureGameWindowMode(undefined),
      DEFAULT_BIG_PICTURE_GAME_WINDOW_MODE
    );
    assert.equal(normalizeBigPictureGameWindowMode("unknown"), "keep-open");
    assert.equal(normalizeBigPictureGameWindowMode("keep-open"), "keep-open");
    assert.equal(normalizeBigPictureGameWindowMode("minimize"), "minimize");
    assert.equal(normalizeBigPictureGameWindowMode("hide"), "hide");
  });
});
