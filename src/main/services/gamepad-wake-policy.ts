import type {
  BigPictureControllerLedMode,
  BigPictureGamepadWakeHint,
  BigPictureGamepadWakeStatus,
  ScreenshotInputBackend,
} from "@types";
import type { ScreenshotInputNativeStatus } from "./native-addon";

export const resolveControllerLedMode = ({
  enabled,
  gamesRunning,
  bigPictureOpen,
}: {
  enabled: boolean;
  gamesRunning: boolean;
  bigPictureOpen: boolean;
}): BigPictureControllerLedMode => {
  if (gamesRunning) return "paused";
  if (!enabled) return "off";
  return bigPictureOpen ? "active" : "idle";
};

export const BIG_PICTURE_WAKE_COOLDOWN_MS = 1_000;

const VALID_BACKENDS = new Set<ScreenshotInputBackend>([
  "windows-raw-input",
  "xinput",
  "x11-xinput2",
  "evdev",
  "global-shortcuts-portal",
  "unavailable",
]);

export const toWakeBackend = (value: string): ScreenshotInputBackend =>
  VALID_BACKENDS.has(value as ScreenshotInputBackend)
    ? (value as ScreenshotInputBackend)
    : "unavailable";

export const toBigPictureGamepadWakeStatus = (
  nativeStatus: Pick<
    ScreenshotInputNativeStatus,
    "gamepadBackend" | "gamepadError"
  >,
  enabled: boolean,
  active: boolean
): BigPictureGamepadWakeStatus => {
  const gamepadBackend = toWakeBackend(nativeStatus.gamepadBackend);
  const hint: BigPictureGamepadWakeHint | null =
    enabled && (nativeStatus.gamepadError || gamepadBackend === "unavailable")
      ? "gamepad_unavailable"
      : null;

  return {
    active,
    gamepadBackend,
    hint,
  };
};

export interface WakeTriggerGuardInput {
  enabled: boolean;
  gamesRunning: boolean;
  bigPictureFocused: boolean;
  now: number;
  lastTriggeredAt: number | null;
  cooldownMs?: number;
}

export const canTriggerBigPictureWake = ({
  enabled,
  gamesRunning,
  bigPictureFocused,
  now,
  lastTriggeredAt,
  cooldownMs = BIG_PICTURE_WAKE_COOLDOWN_MS,
}: WakeTriggerGuardInput) => {
  if (!enabled || gamesRunning || bigPictureFocused) return false;
  if (lastTriggeredAt !== null && now - lastTriggeredAt < cooldownMs) {
    return false;
  }
  return true;
};
