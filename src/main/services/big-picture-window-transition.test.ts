import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  activateBigPictureWindowTransition,
  disableMainWindowForBigPicture,
  restoreMainWindowForBigPictureExit,
  type TransitionWindowHandle,
} from "./big-picture-window-transition.js";

interface MockWindowOptions {
  name: string;
  destroyed?: boolean;
  minimized?: boolean;
  visible?: boolean;
  focused?: boolean;
  focusSucceeds?: boolean;
  log?: string[];
}

const createMockWindow = ({
  name,
  destroyed = false,
  minimized = false,
  visible = false,
  focused = false,
  focusSucceeds = true,
  log = [],
}: MockWindowOptions): TransitionWindowHandle => {
  let isMinimizedState = minimized;
  let isVisibleState = visible;
  let isFocusedState = focused;

  return {
    isDestroyed: () => destroyed,
    isMinimized: () => isMinimizedState,
    isVisible: () => isVisibleState,
    isFocused: () => isFocusedState,
    restore: () => {
      isMinimizedState = false;
      log.push(`${name}.restore`);
    },
    show: () => {
      isVisibleState = true;
      log.push(`${name}.show`);
    },
    hide: () => {
      isVisibleState = false;
      isFocusedState = false;
      log.push(`${name}.hide`);
    },
    focus: () => {
      if (focusSucceeds) {
        isFocusedState = true;
      }
      log.push(`${name}.focus`);
    },
    maximize: () => {
      log.push(`${name}.maximize`);
    },
    setFullScreen: (flag: boolean) => {
      log.push(`${name}.setFullScreen(${flag})`);
    },
    setOpacity: (opacity: number) => {
      log.push(`${name}.setOpacity(${opacity})`);
    },
    setFocusable: (focusable: boolean) => {
      log.push(`${name}.setFocusable(${focusable})`);
    },
    setIgnoreMouseEvents: (ignore: boolean) => {
      log.push(`${name}.setIgnoreMouseEvents(${ignore})`);
    },
    setSkipTaskbar: (skip: boolean) => {
      log.push(`${name}.setSkipTaskbar(${skip})`);
    },
  };
};

describe("Big Picture window transition", () => {
  it("shows and focuses Big Picture before hiding and disabling mainWindow", () => {
    const log: string[] = [];
    const mainWindow = createMockWindow({
      name: "main",
      visible: true,
      focused: true,
      log,
    });
    const bigPicture = createMockWindow({
      name: "bp",
      visible: false,
      focused: false,
      log,
    });

    activateBigPictureWindowTransition({
      bigPicture,
      mainWindow,
      hadForegroundAtStart: true,
      mainWasVisible: true,
      focusFromBackground: (win) => {
        win.focus();
        log.push("focusFromBackground(bp)");
      },
    });

    assert.deepEqual(log, [
      "bp.show",
      "bp.setFullScreen(true)",
      "bp.focus",
      "main.setOpacity(1)",
      "main.hide",
      "main.setFocusable(false)",
      "main.setIgnoreMouseEvents(true)",
    ]);
  });

  it("uses focusFromBackground fallback when focus() fails during cold start or foreground transition", () => {
    const log: string[] = [];
    const mainWindow = createMockWindow({
      name: "main",
      visible: false,
      focused: false,
      log,
    });
    const bigPicture = createMockWindow({
      name: "bp",
      visible: false,
      focused: false,
      focusSucceeds: false,
      log,
    });

    activateBigPictureWindowTransition({
      bigPicture,
      mainWindow,
      hadForegroundAtStart: false,
      mainWasVisible: false,
      focusFromBackground: () => {
        log.push("focusFromBackground(bp)");
      },
    });

    assert.deepEqual(log, [
      "bp.show",
      "bp.setFullScreen(true)",
      "bp.focus",
      "focusFromBackground(bp)",
      "main.setOpacity(1)",
      "main.hide",
      "main.setFocusable(false)",
      "main.setIgnoreMouseEvents(true)",
    ]);
  });

  it("does not steal focus if user switched away from visible mainWindow during load", () => {
    const log: string[] = [];
    const mainWindow = createMockWindow({
      name: "main",
      visible: true,
      focused: false,
      log,
    });
    const bigPicture = createMockWindow({
      name: "bp",
      visible: false,
      focused: false,
      focusSucceeds: false,
      log,
    });

    activateBigPictureWindowTransition({
      bigPicture,
      mainWindow,
      focusSteal: false,
      hadForegroundAtStart: false,
      mainWasVisible: true,
      focusFromBackground: () => {
        log.push("focusFromBackground(bp)");
      },
    });

    assert.equal(log.includes("focusFromBackground(bp)"), false);
    assert.equal(log.indexOf("bp.show") < log.indexOf("main.hide"), true);
  });

  it("restores minimized Big Picture and uses focusFromBackground when focusSteal is true", () => {
    const log: string[] = [];
    const bigPicture = createMockWindow({
      name: "bp",
      minimized: true,
      visible: false,
      log,
    });

    activateBigPictureWindowTransition({
      bigPicture,
      mainWindow: null,
      focusSteal: true,
      focusFromBackground: () => {
        log.push("focusFromBackground(bp)");
      },
    });

    assert.deepEqual(log, [
      "bp.restore",
      "bp.show",
      "bp.setFullScreen(true)",
      "focusFromBackground(bp)",
    ]);
  });

  it("restores, shows, maximizes, and focuses mainWindow before Big Picture closes", () => {
    const log: string[] = [];
    const mainWindow = createMockWindow({
      name: "main",
      visible: false,
      focused: false,
      log,
    });
    const bigPicture = createMockWindow({
      name: "bp",
      visible: true,
      focused: true,
      log,
    });

    const result = restoreMainWindowForBigPictureExit({
      mainWindow,
      bigPicture,
      deferredMainMaximize: true,
      focusFromBackground: () => {
        log.push("focusFromBackground(main)");
      },
    });

    assert.deepEqual(result, {
      restored: true,
      consumedDeferredMaximize: true,
    });
    assert.deepEqual(log, [
      "main.setIgnoreMouseEvents(false)",
      "main.setFocusable(true)",
      "main.setSkipTaskbar(false)",
      "main.setOpacity(1)",
      "main.show",
      "main.maximize",
      "main.focus",
    ]);
  });

  it("falls back to focusFromBackground when mainWindow.focus() is blocked while Big Picture was active", () => {
    const log: string[] = [];
    const mainWindow = createMockWindow({
      name: "main",
      visible: false,
      focused: false,
      focusSucceeds: false,
      log,
    });
    const bigPicture = createMockWindow({
      name: "bp",
      visible: true,
      focused: true,
      log,
    });

    restoreMainWindowForBigPictureExit({
      mainWindow,
      bigPicture,
      deferredMainMaximize: false,
      focusFromBackground: () => {
        log.push("focusFromBackground(main)");
      },
    });

    assert.deepEqual(log, [
      "main.setIgnoreMouseEvents(false)",
      "main.setFocusable(true)",
      "main.setSkipTaskbar(false)",
      "main.setOpacity(1)",
      "main.show",
      "main.focus",
      "focusFromBackground(main)",
    ]);
  });

  it("handles missing or destroyed windows safely", () => {
    const log: string[] = [];
    const destroyedMain = createMockWindow({
      name: "main",
      destroyed: true,
      log,
    });
    const destroyedBp = createMockWindow({
      name: "bp",
      destroyed: true,
      log,
    });

    disableMainWindowForBigPicture(destroyedMain);
    activateBigPictureWindowTransition({
      bigPicture: destroyedBp,
      mainWindow: destroyedMain,
      focusFromBackground: () => log.push("focusFromBackground"),
    });
    const result = restoreMainWindowForBigPictureExit({
      mainWindow: destroyedMain,
      bigPicture: destroyedBp,
      deferredMainMaximize: true,
      focusFromBackground: () => log.push("focusFromBackground"),
    });

    assert.deepEqual(result, {
      restored: false,
      consumedDeferredMaximize: false,
    });
    assert.deepEqual(log, []);
  });
});
