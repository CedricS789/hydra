import type {
  ScreenshotGamepadButton,
  ScreenshotInputBackend,
} from "./screenshot.types";

export type BigPictureGamepadWakeMode = "home-hold" | "home-press" | "combo";

export type BigPictureHomeButtonPage =
  | "home"
  | "library"
  | "catalogue"
  | "downloads"
  | "profile"
  | "settings";

export type BigPictureHomeButtonAction =
  | "power-menu"
  | BigPictureHomeButtonPage;

export type BigPictureGameWindowMode = "keep-open" | "minimize" | "hide";

export type BigPictureControllerLedMode = "off" | "idle" | "active" | "paused";

export type BigPictureControllerLedPresetId =
  | "hydra-cyan"
  | "ps-blue"
  | "dualsense-white"
  | "ps-cross"
  | "ps-circle"
  | "ps-triangle"
  | "ps-square"
  | "amber-gold";

export interface BigPictureControllerLedPreset {
  id: BigPictureControllerLedPresetId;
  hex: string;
  labelKey: string;
  bigPictureLabelKey: string;
  descriptionKey: string;
}

export type BigPictureGamepadWakeHint = "gamepad_unavailable";

export interface BigPictureGamepadWakeStatus {
  active: boolean;
  gamepadBackend: ScreenshotInputBackend;
  hint: BigPictureGamepadWakeHint | null;
}

export interface BigPictureGamepadWakeSettings {
  enabled: boolean;
  mode: BigPictureGamepadWakeMode;
  combo: ScreenshotGamepadButton[];
  homeButtonAction: BigPictureHomeButtonAction;
  controllerLedEnabled: boolean;
  controllerLedColor: string;
  controllerLedCustomColors: string[];
}
