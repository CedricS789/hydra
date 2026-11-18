import type {
  BigPictureGamepadWakeSettings,
  BigPictureGamepadWakeStatus,
  UserPreferences,
} from "@types";
import {
  resolveBigPictureGamepadWakeSettings,
  toNativeBigPictureWakeConfig,
} from "@shared";
import {
  hasTrackedGamesRunning,
  onTrackedGamesRunningChange,
} from "./game-running-state";
import {
  canTriggerBigPictureWake,
  resolveControllerLedMode,
  toBigPictureGamepadWakeStatus,
} from "./gamepad-wake-policy";
import { logger } from "./logger";
import type { ScreenshotInputNativeEvent } from "./native-addon";
import { NativeInputCoordinator } from "./native-input-coordinator";
import { WindowManager } from "./window-manager";

type GamepadWakeStatusListener = (status: BigPictureGamepadWakeStatus) => void;

export const BIG_PICTURE_WAKE_RESTART_DELAY_MS = 5_000;
export const BIG_PICTURE_WAKE_MAX_RESTARTS = 3;

const INACTIVE_STATUS: BigPictureGamepadWakeStatus = {
  active: false,
  gamepadBackend: "unavailable",
  hint: null,
};

const isSameStatus = (
  left: BigPictureGamepadWakeStatus,
  right: BigPictureGamepadWakeStatus
) =>
  left.active === right.active &&
  left.gamepadBackend === right.gamepadBackend &&
  left.hint === right.hint;

export class GamepadWakeService {
  private static readonly statusListeners =
    new Set<GamepadWakeStatusListener>();

  private static settings: BigPictureGamepadWakeSettings =
    resolveBigPictureGamepadWakeSettings(null);
  private static status: BigPictureGamepadWakeStatus = { ...INACTIVE_STATUS };
  private static initialized = false;
  private static shuttingDown = false;
  private static listening = false;
  private static gamesRunning = false;
  private static bigPictureOpen = false;
  private static sessionGeneration = 0;
  private static lastTriggeredAt: number | null = null;
  private static restartAttempts = 0;
  private static restartTimer: ReturnType<typeof setTimeout> | null = null;
  private static pendingGamesRunningCheck: ReturnType<
    typeof setImmediate
  > | null = null;
  private static unsubscribeGamesRunning: (() => void) | null = null;

  public static onStatusChange(listener: GamepadWakeStatusListener) {
    this.statusListeners.add(listener);
    return () => {
      this.statusListeners.delete(listener);
    };
  }

  public static setBigPictureOpen(open: boolean) {
    if (this.bigPictureOpen === open) return;
    this.bigPictureOpen = open;
    if (this.initialized && !this.shuttingDown) {
      this.reconcile();
    }
  }

  public static syncUserPreferences(preferences: UserPreferences | null) {
    this.settings = resolveBigPictureGamepadWakeSettings(preferences);

    if (!this.initialized) {
      this.initialized = true;
      this.gamesRunning = hasTrackedGamesRunning();
      this.unsubscribeGamesRunning = onTrackedGamesRunningChange(() =>
        this.scheduleGamesRunningCheck()
      );
    }

    this.reconcile();
  }

  public static refreshStatus(): BigPictureGamepadWakeStatus {
    if (this.listening || this.shuttingDown) return this.status;

    const wakeConfig = toNativeBigPictureWakeConfig(this.settings);
    try {
      const probe = NativeInputCoordinator.probe({
        keyboardEnabled: false,
        gamepadEnabled: false,
        wakeEnabled: true,
        wakeMode: wakeConfig.wakeMode,
        wakeButtons:
          wakeConfig.wakeButtons.length > 0 ? wakeConfig.wakeButtons : ["home"],
        wakeHoldMs: wakeConfig.wakeHoldMs,
      });
      this.setStatus(
        toBigPictureGamepadWakeStatus(probe, this.settings.enabled, false)
      );
    } catch (error) {
      logger.error("Failed to probe Big Picture gamepad wake backend", error);
    }

    return this.status;
  }

  public static shutdown() {
    this.shuttingDown = true;
    this.cancelRestart();
    this.cancelGamesRunningCheck();
    this.unsubscribeGamesRunning?.();
    this.unsubscribeGamesRunning = null;
    this.stopListening();
  }

  private static shouldListen() {
    return (
      this.initialized &&
      !this.shuttingDown &&
      !this.gamesRunning &&
      (this.settings.enabled || this.settings.controllerLedEnabled)
    );
  }

  private static scheduleGamesRunningCheck() {
    if (this.pendingGamesRunningCheck) return;
    this.pendingGamesRunningCheck = setImmediate(() => {
      this.pendingGamesRunningCheck = null;
      const running = hasTrackedGamesRunning();
      if (running === this.gamesRunning) return;
      this.gamesRunning = running;
      this.reconcile();
    });
  }

  private static cancelGamesRunningCheck() {
    if (!this.pendingGamesRunningCheck) return;
    clearImmediate(this.pendingGamesRunningCheck);
    this.pendingGamesRunningCheck = null;
  }

  private static reconcile() {
    if (!this.shouldListen()) {
      this.cancelRestart();
      this.restartAttempts = 0;
      if (this.gamesRunning && this.listening) {
        this.listening = false;
        const generation = this.sessionGeneration;
        NativeInputCoordinator.setWakeRegistration({
          active: false,
          wakeEnabled: false,
          wakeMode: "press",
          wakeButtons: [],
          wakeHoldMs: 0,
          controllerLedMode: "paused",
          controllerLedColor: this.settings.controllerLedColor,
          onEvent: (event) => this.handleNativeEvent(event, generation),
        });
        this.setStatus({ ...this.status, active: false });
        return;
      }
      this.stopListening();
      return;
    }

    if (!this.listening) {
      this.startListening();
      return;
    }

    this.applyRegistration(this.sessionGeneration);
  }

  private static applyRegistration(generation: number) {
    const wakeConfig = toNativeBigPictureWakeConfig(this.settings);
    const controllerLedMode = resolveControllerLedMode({
      enabled: this.settings.controllerLedEnabled,
      gamesRunning: this.gamesRunning,
      bigPictureOpen: this.bigPictureOpen,
    });
    return NativeInputCoordinator.setWakeRegistration({
      active: true,
      wakeEnabled: wakeConfig.wakeEnabled,
      wakeMode: wakeConfig.wakeMode,
      wakeButtons: wakeConfig.wakeButtons,
      wakeHoldMs: wakeConfig.wakeHoldMs,
      controllerLedMode,
      controllerLedColor: this.settings.controllerLedColor,
      onEvent: (event) => this.handleNativeEvent(event, generation),
    });
  }

  private static startListening() {
    const generation = ++this.sessionGeneration;
    try {
      const nativeStatus = this.applyRegistration(generation);
      if (!nativeStatus) {
        throw new Error("Native gamepad wake session unavailable");
      }
      this.listening = true;
      const nextStatus = toBigPictureGamepadWakeStatus(
        nativeStatus,
        this.settings.enabled,
        true
      );
      this.setStatus(nextStatus);
      logger.info("Big Picture gamepad wake listening", {
        ...nextStatus,
        mode: this.settings.mode,
      });
    } catch (error) {
      logger.error("Failed to start Big Picture gamepad wake", error);
      this.listening = false;
      this.setStatus({
        active: false,
        gamepadBackend: "unavailable",
        hint: "gamepad_unavailable",
      });
    }
  }

  private static stopListening() {
    if (!this.listening) return;
    this.listening = false;
    NativeInputCoordinator.setWakeRegistration(null);
    this.setStatus({ ...this.status, active: false });
  }

  private static handleNativeEvent(
    event: ScreenshotInputNativeEvent,
    generation: number
  ) {
    if (!this.listening || generation !== this.sessionGeneration) {
      return;
    }

    if (event.kind === "stopped") {
      logger.warn("Big Picture gamepad wake backend stopped", {
        backend: event.backend,
        restartAttempts: this.restartAttempts,
      });
      this.stopListening();
      this.refreshStatus();

      if (this.restartAttempts >= BIG_PICTURE_WAKE_MAX_RESTARTS) return;
      this.restartAttempts += 1;
      this.cancelRestart();
      this.restartTimer = setTimeout(() => {
        this.restartTimer = null;
        this.reconcile();
      }, BIG_PICTURE_WAKE_RESTART_DELAY_MS);
      this.restartTimer.unref?.();
      return;
    }

    const now = performance.now();
    const canWake = canTriggerBigPictureWake({
      enabled: this.settings.enabled,
      gamesRunning: hasTrackedGamesRunning(),
      bigPictureFocused: WindowManager.isBigPictureFocused(),
      now,
      lastTriggeredAt: this.lastTriggeredAt,
    });

    if (!canWake) {
      return;
    }

    this.lastTriggeredAt = now;
    this.restartAttempts = 0;
    logger.info("Waking Big Picture from gamepad", {
      backend: event.backend,
      mode: this.settings.mode,
    });
    void WindowManager.openBigPictureWindow({ focusSteal: true });
  }

  private static cancelRestart() {
    if (!this.restartTimer) return;
    clearTimeout(this.restartTimer);
    this.restartTimer = null;
  }

  private static setStatus(status: BigPictureGamepadWakeStatus) {
    if (isSameStatus(this.status, status)) return;
    this.status = status;

    for (const listener of this.statusListeners) {
      try {
        listener(status);
      } catch (error) {
        logger.error("Gamepad wake status listener failed", error);
      }
    }
  }
}
