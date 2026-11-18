import type {
  BigPictureControllerLedPreset,
  BigPictureGameWindowMode,
  BigPictureGamepadWakeMode,
  BigPictureGamepadWakeSettings,
  BigPictureHomeButtonAction,
  BigPictureHomeButtonPage,
  ScreenshotGamepadButton,
  UserPreferences,
} from "@types";
import { normalizeScreenshotGamepadCombo } from "./screenshot-input.js";

export const DEFAULT_BIG_PICTURE_GAMEPAD_WAKE_ENABLED = true;
export const DEFAULT_BIG_PICTURE_GAMEPAD_WAKE_MODE: BigPictureGamepadWakeMode =
  "home-hold";
export const DEFAULT_BIG_PICTURE_GAMEPAD_WAKE_HOLD_MS = 400;
export const DEFAULT_BIG_PICTURE_GAMEPAD_WAKE_COMBO: readonly ScreenshotGamepadButton[] =
  ["back", "start"];
export const DEFAULT_BIG_PICTURE_HOME_BUTTON_ACTION: BigPictureHomeButtonAction =
  "power-menu";
export const DEFAULT_BIG_PICTURE_GAME_WINDOW_MODE: BigPictureGameWindowMode =
  "keep-open";
export const DEFAULT_BIG_PICTURE_CONTROLLER_LED_ENABLED = true;
export const DEFAULT_BIG_PICTURE_CONTROLLER_LED_COLOR = "#1c9af6";

export const BIG_PICTURE_CONTROLLER_LED_PRESETS: readonly BigPictureControllerLedPreset[] =
  [
    {
      id: "hydra-cyan",
      hex: "#1c9af6",
      labelKey: "big_picture_led_preset_hydra_cyan",
      bigPictureLabelKey: "settings_led_preset_hydra_cyan",
      descriptionKey: "settings_led_preset_hydra_cyan_desc",
    },
    {
      id: "ps-blue",
      hex: "#0022ff",
      labelKey: "big_picture_led_preset_ps_blue",
      bigPictureLabelKey: "settings_led_preset_ps_blue",
      descriptionKey: "settings_led_preset_ps_blue_desc",
    },
    {
      id: "dualsense-white",
      hex: "#dce6ff",
      labelKey: "big_picture_led_preset_dualsense_white",
      bigPictureLabelKey: "settings_led_preset_dualsense_white",
      descriptionKey: "settings_led_preset_dualsense_white_desc",
    },
    {
      id: "ps-cross",
      hex: "#5ca9ff",
      labelKey: "big_picture_led_preset_ps_cross",
      bigPictureLabelKey: "settings_led_preset_ps_cross",
      descriptionKey: "settings_led_preset_ps_cross_desc",
    },
    {
      id: "ps-circle",
      hex: "#ff4d6d",
      labelKey: "big_picture_led_preset_ps_circle",
      bigPictureLabelKey: "settings_led_preset_ps_circle",
      descriptionKey: "settings_led_preset_ps_circle_desc",
    },
    {
      id: "ps-triangle",
      hex: "#40e2a0",
      labelKey: "big_picture_led_preset_ps_triangle",
      bigPictureLabelKey: "settings_led_preset_ps_triangle",
      descriptionKey: "settings_led_preset_ps_triangle_desc",
    },
    {
      id: "ps-square",
      hex: "#e066ff",
      labelKey: "big_picture_led_preset_ps_square",
      bigPictureLabelKey: "settings_led_preset_ps_square",
      descriptionKey: "settings_led_preset_ps_square_desc",
    },
    {
      id: "amber-gold",
      hex: "#ff9f1c",
      labelKey: "big_picture_led_preset_amber_gold",
      bigPictureLabelKey: "settings_led_preset_amber_gold",
      descriptionKey: "settings_led_preset_amber_gold_desc",
    },
  ];

export const MAX_BIG_PICTURE_CONTROLLER_LED_CUSTOM_COLORS = 8;

const HEX_COLOR_PATTERN = /^#?[0-9a-f]{6}$/i;

const parseValidControllerLedColor = (
  color: string | null | undefined
): string | null => {
  if (typeof color !== "string") return null;
  const trimmed = color.trim();
  if (!HEX_COLOR_PATTERN.test(trimmed)) return null;
  const bare = trimmed.startsWith("#") ? trimmed.slice(1) : trimmed;
  return `#${bare.toLowerCase()}`;
};

export const normalizeControllerLedColor = (
  color: string | null | undefined
): string =>
  parseValidControllerLedColor(color) ??
  DEFAULT_BIG_PICTURE_CONTROLLER_LED_COLOR;

export const findControllerLedPreset = (
  color: string | null | undefined
): BigPictureControllerLedPreset | null => {
  const normalized = normalizeControllerLedColor(color);
  return (
    BIG_PICTURE_CONTROLLER_LED_PRESETS.find(
      (preset) => preset.hex === normalized
    ) ?? null
  );
};

export const normalizeControllerLedCustomColors = (
  colors: readonly string[] | null | undefined
): string[] => {
  if (!Array.isArray(colors) || colors.length === 0) return [];
  const presetHexes = new Set(
    BIG_PICTURE_CONTROLLER_LED_PRESETS.map((preset) => preset.hex)
  );
  const unique: string[] = [];
  for (const item of colors) {
    const parsed = parseValidControllerLedColor(item);
    if (!parsed || presetHexes.has(parsed) || unique.includes(parsed)) {
      continue;
    }
    unique.push(parsed);
    if (unique.length >= MAX_BIG_PICTURE_CONTROLLER_LED_CUSTOM_COLORS) {
      break;
    }
  }
  return unique;
};

export const addControllerLedCustomColor = (
  existing: readonly string[] | null | undefined,
  color: string
): string[] => {
  const normalized = normalizeControllerLedCustomColors(existing);
  const parsed = parseValidControllerLedColor(color);
  if (!parsed || findControllerLedPreset(parsed)) {
    return normalized;
  }
  if (
    normalized.includes(parsed) ||
    normalized.length >= MAX_BIG_PICTURE_CONTROLLER_LED_CUSTOM_COLORS
  ) {
    return normalized;
  }
  return [...normalized, parsed];
};

export const removeControllerLedCustomColor = (
  existing: readonly string[] | null | undefined,
  color: string
): string[] => {
  const parsed = parseValidControllerLedColor(color);
  const normalized = normalizeControllerLedCustomColors(existing);
  if (!parsed) return normalized;
  return normalized.filter((item) => item !== parsed);
};

export const computeControllerLedIdleHex = (color: string): string => {
  const normalized = normalizeControllerLedColor(color);
  const scale = (offset: number) => {
    const channel = Number.parseInt(normalized.slice(offset, offset + 2), 16);
    if (channel === 0) return "00";
    const scaled = Math.max(1, Math.floor((channel * 28) / 100));
    return scaled.toString(16).padStart(2, "0");
  };
  return `#${scale(1)}${scale(3)}${scale(5)}`;
};

export const BIG_PICTURE_HOME_PAGE_PATHS: Record<
  BigPictureHomeButtonPage,
  string
> = {
  home: "/",
  library: "/library",
  catalogue: "/catalogue",
  downloads: "/downloads",
  profile: "/profile",
  settings: "/settings",
};

export interface BigPictureHomeActionOptionSpec {
  value: BigPictureHomeButtonAction;
  desktopLabelKey: string;
  bigPictureLabelKey: string;
}

export const BIG_PICTURE_HOME_ACTION_OPTIONS: readonly BigPictureHomeActionOptionSpec[] =
  [
    {
      value: "power-menu",
      desktopLabelKey: "big_picture_home_action_power_menu",
      bigPictureLabelKey: "settings_home_action_power_menu",
    },
    {
      value: "home",
      desktopLabelKey: "big_picture_home_action_home",
      bigPictureLabelKey: "settings_home_action_home",
    },
    {
      value: "library",
      desktopLabelKey: "big_picture_home_action_library",
      bigPictureLabelKey: "settings_home_action_library",
    },
    {
      value: "catalogue",
      desktopLabelKey: "big_picture_home_action_catalogue",
      bigPictureLabelKey: "settings_home_action_catalogue",
    },
    {
      value: "downloads",
      desktopLabelKey: "big_picture_home_action_downloads",
      bigPictureLabelKey: "settings_home_action_downloads",
    },
    {
      value: "profile",
      desktopLabelKey: "big_picture_home_action_profile",
      bigPictureLabelKey: "settings_home_action_profile",
    },
    {
      value: "settings",
      desktopLabelKey: "big_picture_home_action_settings",
      bigPictureLabelKey: "settings_home_action_settings",
    },
  ];

const VALID_WAKE_MODES = new Set<BigPictureGamepadWakeMode>([
  "home-hold",
  "home-press",
  "combo",
]);

const VALID_HOME_BUTTON_ACTIONS = new Set<BigPictureHomeButtonAction>(
  BIG_PICTURE_HOME_ACTION_OPTIONS.map((option) => option.value)
);

export interface BigPictureGameWindowModeOptionSpec {
  value: BigPictureGameWindowMode;
  desktopLabelKey: string;
  bigPictureLabelKey: string;
  descriptionKey: string;
}

export const BIG_PICTURE_GAME_WINDOW_MODE_OPTIONS: readonly BigPictureGameWindowModeOptionSpec[] =
  [
    {
      value: "keep-open",
      desktopLabelKey: "big_picture_game_window_mode_keep_open",
      bigPictureLabelKey: "settings_game_window_mode_keep_open",
      descriptionKey: "settings_game_window_mode_keep_open_desc",
    },
    {
      value: "minimize",
      desktopLabelKey: "big_picture_game_window_mode_minimize",
      bigPictureLabelKey: "settings_game_window_mode_minimize",
      descriptionKey: "settings_game_window_mode_minimize_desc",
    },
    {
      value: "hide",
      desktopLabelKey: "big_picture_game_window_mode_hide",
      bigPictureLabelKey: "settings_game_window_mode_hide",
      descriptionKey: "settings_game_window_mode_hide_desc",
    },
  ];

const VALID_GAME_WINDOW_MODES = new Set<BigPictureGameWindowMode>(
  BIG_PICTURE_GAME_WINDOW_MODE_OPTIONS.map((option) => option.value)
);

export const normalizeBigPictureGameWindowMode = (
  mode: BigPictureGameWindowMode | string | null | undefined
): BigPictureGameWindowMode =>
  mode && VALID_GAME_WINDOW_MODES.has(mode as BigPictureGameWindowMode)
    ? (mode as BigPictureGameWindowMode)
    : DEFAULT_BIG_PICTURE_GAME_WINDOW_MODE;

export const normalizeBigPictureRoutePathname = (pathname: string): string => {
  let end = pathname.length;
  while (end > 0 && pathname[end - 1] === "/") end--;
  const trimmed = end === 0 ? "/" : pathname.slice(0, end);
  if (trimmed === "/big-picture") return "/";
  if (trimmed.startsWith("/big-picture/")) {
    return trimmed.slice("/big-picture".length) || "/";
  }
  return trimmed;
};

export const resolveBigPictureHomeNavigationTarget = (
  action: BigPictureHomeButtonAction,
  currentPathname: string,
  isDesktop: boolean
): string | null => {
  if (action === "power-menu") return null;
  const relativePath = BIG_PICTURE_HOME_PAGE_PATHS[action];
  if (!relativePath) return null;

  const current = normalizeBigPictureRoutePathname(currentPathname);
  const alreadyOnTarget =
    relativePath === "/profile"
      ? current === "/profile" || current.startsWith("/profile/")
      : current === relativePath;
  if (alreadyOnTarget) {
    return null;
  }

  if (!isDesktop) {
    return relativePath;
  }

  return relativePath === "/" ? "/big-picture" : `/big-picture${relativePath}`;
};

export const normalizeBigPictureGamepadWakeMode = (
  mode: BigPictureGamepadWakeMode | string | null | undefined
): BigPictureGamepadWakeMode =>
  mode && VALID_WAKE_MODES.has(mode as BigPictureGamepadWakeMode)
    ? (mode as BigPictureGamepadWakeMode)
    : DEFAULT_BIG_PICTURE_GAMEPAD_WAKE_MODE;

export const normalizeBigPictureHomeButtonAction = (
  action: BigPictureHomeButtonAction | string | null | undefined
): BigPictureHomeButtonAction =>
  action && VALID_HOME_BUTTON_ACTIONS.has(action as BigPictureHomeButtonAction)
    ? (action as BigPictureHomeButtonAction)
    : DEFAULT_BIG_PICTURE_HOME_BUTTON_ACTION;

export const normalizeBigPictureGamepadWakeCombo = (
  combo: readonly string[] | null | undefined
): ScreenshotGamepadButton[] => {
  if (!combo || combo.length === 0) {
    return [...DEFAULT_BIG_PICTURE_GAMEPAD_WAKE_COMBO];
  }
  return normalizeScreenshotGamepadCombo(combo);
};

export const resolveBigPictureGamepadWakeSettings = (
  preferences: UserPreferences | null | undefined
): BigPictureGamepadWakeSettings => ({
  enabled:
    preferences?.bigPictureGamepadWakeEnabled ??
    DEFAULT_BIG_PICTURE_GAMEPAD_WAKE_ENABLED,
  mode: normalizeBigPictureGamepadWakeMode(
    preferences?.bigPictureGamepadWakeMode
  ),
  combo: normalizeBigPictureGamepadWakeCombo(
    preferences?.bigPictureGamepadWakeCombo
  ),
  homeButtonAction: normalizeBigPictureHomeButtonAction(
    preferences?.bigPictureHomeButtonAction
  ),
  controllerLedEnabled:
    preferences?.bigPictureControllerLedEnabled ??
    DEFAULT_BIG_PICTURE_CONTROLLER_LED_ENABLED,
  controllerLedColor: normalizeControllerLedColor(
    preferences?.bigPictureControllerLedColor
  ),
  controllerLedCustomColors: normalizeControllerLedCustomColors(
    preferences?.bigPictureControllerLedCustomColors
  ),
});

export interface NativeBigPictureWakeConfig {
  wakeEnabled: boolean;
  wakeMode: "press" | "hold";
  wakeButtons: string[];
  wakeHoldMs: number;
}

export const toNativeBigPictureWakeConfig = (
  settings: Pick<BigPictureGamepadWakeSettings, "enabled" | "mode" | "combo">
): NativeBigPictureWakeConfig => {
  if (!settings.enabled) {
    return {
      wakeEnabled: false,
      wakeMode: "press",
      wakeButtons: [],
      wakeHoldMs: 0,
    };
  }

  if (settings.mode === "combo") {
    return {
      wakeEnabled: true,
      wakeMode: "press",
      wakeButtons: [...settings.combo],
      wakeHoldMs: 0,
    };
  }

  if (settings.mode === "home-press") {
    return {
      wakeEnabled: true,
      wakeMode: "press",
      wakeButtons: ["home"],
      wakeHoldMs: 0,
    };
  }

  return {
    wakeEnabled: true,
    wakeMode: "hold",
    wakeButtons: ["home"],
    wakeHoldMs: DEFAULT_BIG_PICTURE_GAMEPAD_WAKE_HOLD_MS,
  };
};

export const isSameBigPictureGamepadWakeSettings = (
  left: Pick<
    BigPictureGamepadWakeSettings,
    | "enabled"
    | "mode"
    | "combo"
    | "controllerLedEnabled"
    | "controllerLedColor"
    | "controllerLedCustomColors"
  >,
  right: Pick<
    BigPictureGamepadWakeSettings,
    | "enabled"
    | "mode"
    | "combo"
    | "controllerLedEnabled"
    | "controllerLedColor"
    | "controllerLedCustomColors"
  >
) =>
  left.enabled === right.enabled &&
  left.mode === right.mode &&
  left.controllerLedEnabled === right.controllerLedEnabled &&
  left.controllerLedColor === right.controllerLedColor &&
  left.combo.length === right.combo.length &&
  left.combo.every((button, index) => button === right.combo[index]) &&
  left.controllerLedCustomColors.length ===
    right.controllerLedCustomColors.length &&
  left.controllerLedCustomColors.every(
    (color, index) => color === right.controllerLedCustomColors[index]
  );
