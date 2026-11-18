import {
  DEFAULT_BIG_PICTURE_CONTROLLER_LED_COLOR,
  DEFAULT_SCREENSHOT_HOTKEY,
} from "@shared";
import { logger } from "./logger";
import {
  NativeAddon,
  type ScreenshotInputNativeConfig,
  type ScreenshotInputNativeEvent,
  type ScreenshotInputNativeStatus,
} from "./native-addon";

export interface ScreenshotNativeRegistration {
  active: boolean;
  key: string;
  ctrl: boolean;
  alt: boolean;
  shift: boolean;
  gamepadEnabled: boolean;
  gamepadButtons: string[];
  onEvent: (event: ScreenshotInputNativeEvent) => void;
}

export interface WakeNativeRegistration {
  active: boolean;
  wakeEnabled: boolean;
  wakeMode: "press" | "hold";
  wakeButtons: string[];
  wakeHoldMs: number;
  controllerLedMode: "off" | "idle" | "active" | "paused";
  controllerLedColor: string;
  onEvent: (event: ScreenshotInputNativeEvent) => void;
}

interface StartSignature {
  keyboard: boolean;
  gamepad: boolean;
}

const DEFAULT_INACTIVE_SCREENSHOT: Omit<
  ScreenshotNativeRegistration,
  "onEvent"
> = {
  active: false,
  key: DEFAULT_SCREENSHOT_HOTKEY.key,
  ctrl: DEFAULT_SCREENSHOT_HOTKEY.ctrl,
  alt: DEFAULT_SCREENSHOT_HOTKEY.alt,
  shift: DEFAULT_SCREENSHOT_HOTKEY.shift,
  gamepadEnabled: false,
  gamepadButtons: [],
};

const DEFAULT_INACTIVE_WAKE: Omit<WakeNativeRegistration, "onEvent"> = {
  active: false,
  wakeEnabled: false,
  wakeMode: "press",
  wakeButtons: [],
  wakeHoldMs: 0,
  controllerLedMode: "off",
  controllerLedColor: DEFAULT_BIG_PICTURE_CONTROLLER_LED_COLOR,
};

export class NativeInputCoordinator {
  private static screenshot: ScreenshotNativeRegistration | null = null;
  private static wake: WakeNativeRegistration | null = null;
  private static runningSignature: StartSignature | null = null;
  private static sessionGeneration = 0;
  private static lastStatus: ScreenshotInputNativeStatus | null = null;

  public static setScreenshotRegistration(
    registration: ScreenshotNativeRegistration | null
  ): ScreenshotInputNativeStatus | null {
    this.screenshot = registration;
    return this.reconcile();
  }

  public static setWakeRegistration(
    registration: WakeNativeRegistration | null
  ): ScreenshotInputNativeStatus | null {
    this.wake = registration;
    return this.reconcile();
  }

  public static probe(
    overrides?: Partial<ScreenshotInputNativeConfig>
  ): ScreenshotInputNativeStatus {
    const config = {
      ...this.buildMergedConfig(),
      ...overrides,
    };
    return NativeAddon.probeScreenshotInput(config);
  }

  public static getLastStatus(): ScreenshotInputNativeStatus | null {
    return this.lastStatus;
  }

  public static shutdown() {
    this.screenshot = null;
    this.wake = null;
    this.stop();
  }

  private static buildMergedConfig(): ScreenshotInputNativeConfig {
    const ss = this.screenshot ?? DEFAULT_INACTIVE_SCREENSHOT;
    const wk = this.wake ?? DEFAULT_INACTIVE_WAKE;

    return {
      key: ss.key,
      ctrl: ss.ctrl,
      alt: ss.alt,
      shift: ss.shift,
      gamepadEnabled: Boolean(ss.active && ss.gamepadEnabled),
      gamepadButtons: [...ss.gamepadButtons],
      keyboardEnabled: Boolean(ss.active),
      wakeEnabled: Boolean(wk.active && wk.wakeEnabled),
      wakeMode: wk.wakeMode,
      wakeButtons: [...wk.wakeButtons],
      wakeHoldMs: wk.wakeHoldMs,
      controllerLedMode: wk.controllerLedMode,
      controllerLedColor: wk.controllerLedColor,
    };
  }

  private static desiredSignature(
    config: ScreenshotInputNativeConfig
  ): StartSignature {
    return {
      keyboard: Boolean(config.keyboardEnabled),
      gamepad:
        Boolean(config.gamepadEnabled && config.gamepadButtons.length >= 2) ||
        Boolean(config.wakeEnabled && (config.wakeButtons?.length ?? 0) >= 1) ||
        config.controllerLedMode === "idle" ||
        config.controllerLedMode === "active",
    };
  }

  private static reconcile(): ScreenshotInputNativeStatus | null {
    const config = this.buildMergedConfig();
    const desired = this.desiredSignature(config);

    if (!desired.keyboard && !desired.gamepad) {
      this.stop();
      return null;
    }

    if (
      !this.runningSignature ||
      this.runningSignature.keyboard !== desired.keyboard ||
      this.runningSignature.gamepad !== desired.gamepad
    ) {
      return this.start(config, desired);
    }

    try {
      NativeAddon.updateScreenshotInputBinding(config);
    } catch (error) {
      logger.error("Failed to update native input binding", error);
    }

    return this.lastStatus;
  }

  private static start(
    config: ScreenshotInputNativeConfig,
    signature: StartSignature
  ): ScreenshotInputNativeStatus | null {
    const generation = ++this.sessionGeneration;
    try {
      const status = NativeAddon.startScreenshotInput(config, (event) =>
        this.handleNativeEvent(event, generation)
      );
      this.runningSignature = signature;
      this.lastStatus = status;
      return status;
    } catch (error) {
      logger.error("Failed to start native input session", error);
      this.runningSignature = null;
      this.lastStatus = null;
      return null;
    }
  }

  private static stop() {
    if (!this.runningSignature) return;
    this.runningSignature = null;
    this.lastStatus = null;
    this.sessionGeneration += 1;
    try {
      NativeAddon.stopScreenshotInput();
    } catch (error) {
      logger.error("Failed to stop native input session", error);
    }
  }

  private static handleNativeEvent(
    event: ScreenshotInputNativeEvent,
    generation: number
  ) {
    if (generation !== this.sessionGeneration || !this.runningSignature) {
      return;
    }

    if (event.kind === "stopped") {
      this.runningSignature = null;
      this.lastStatus = null;
      if (this.screenshot?.active) {
        this.screenshot.onEvent(event);
      }
      if (this.wake?.active) {
        this.wake.onEvent(event);
      }
      return;
    }

    if (event.action === "big-picture-wake") {
      if (this.wake?.active) {
        this.wake.onEvent(event);
      }
      return;
    }

    if (this.screenshot?.active) {
      this.screenshot.onEvent(event);
    }
  }
}
