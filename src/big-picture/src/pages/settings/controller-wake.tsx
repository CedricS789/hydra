import { useSettingsDraft } from "@renderer/context/settings/settings-draft.context";
import {
  BIG_PICTURE_CONTROLLER_LED_PRESETS,
  BIG_PICTURE_GAME_WINDOW_MODE_OPTIONS,
  BIG_PICTURE_HOME_ACTION_OPTIONS,
  computeControllerLedIdleHex,
  DEFAULT_BIG_PICTURE_GAME_WINDOW_MODE,
  findControllerLedPreset,
  normalizeBigPictureGameWindowMode,
  resolveBigPictureGamepadWakeSettings,
} from "@shared";
import type {
  BigPictureGameWindowMode,
  BigPictureGamepadWakeMode,
  BigPictureHomeButtonAction,
  ScreenshotGamepadButton,
  UserPreferences,
} from "@types";
import cn from "classnames";
import {
  type CSSProperties,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";
import { useTranslation } from "react-i18next";

import { Checkbox, DropdownSelect, VerticalFocusGroup } from "../../components";
import type { DropdownSelectOption } from "../../components/common/dropdown-select";
import { useUserPreferences } from "../../hooks";
import type { FocusOverrides } from "../../services";
import {
  BIG_PICTURE_CONTROLLER_SECTION_REGION_ID,
  BIG_PICTURE_GAME_WINDOW_MODE_SELECT_ID,
  BIG_PICTURE_HOME_BUTTON_ACTION_SELECT_ID,
  BIG_PICTURE_ITEM_FOCUS_IDS,
  BIG_PICTURE_LED_COLOR_SELECT_ID,
  BIG_PICTURE_WAKE_MODE_SELECT_ID,
} from "./settings-navigation";
import { SettingsSection } from "./settings-section";

import "./controller-wake.scss";

interface ControllerWakeForm {
  bigPictureGamepadWakeEnabled: boolean;
  bigPictureGamepadWakeMode: BigPictureGamepadWakeMode;
  bigPictureGamepadWakeCombo: ScreenshotGamepadButton[];
  bigPictureHomeButtonAction: BigPictureHomeButtonAction;
  bigPictureGameWindowMode: BigPictureGameWindowMode;
  bigPictureControllerLedEnabled: boolean;
  bigPictureControllerLedColor: string;
  bigPictureControllerLedCustomColors: string[];
}

const DEFAULT_WAKE = resolveBigPictureGamepadWakeSettings(null);

const buildForm = (preferences: UserPreferences | null): ControllerWakeForm => {
  if (!preferences) {
    return {
      bigPictureGamepadWakeEnabled: DEFAULT_WAKE.enabled,
      bigPictureGamepadWakeMode: DEFAULT_WAKE.mode,
      bigPictureGamepadWakeCombo: [...DEFAULT_WAKE.combo],
      bigPictureHomeButtonAction: DEFAULT_WAKE.homeButtonAction,
      bigPictureGameWindowMode: DEFAULT_BIG_PICTURE_GAME_WINDOW_MODE,
      bigPictureControllerLedEnabled: DEFAULT_WAKE.controllerLedEnabled,
      bigPictureControllerLedColor: DEFAULT_WAKE.controllerLedColor,
      bigPictureControllerLedCustomColors: [
        ...DEFAULT_WAKE.controllerLedCustomColors,
      ],
    };
  }
  const wake = resolveBigPictureGamepadWakeSettings(preferences);
  return {
    bigPictureGamepadWakeEnabled: wake.enabled,
    bigPictureGamepadWakeMode: wake.mode,
    bigPictureGamepadWakeCombo: wake.combo,
    bigPictureHomeButtonAction: wake.homeButtonAction,
    bigPictureGameWindowMode: normalizeBigPictureGameWindowMode(
      preferences.bigPictureGameWindowMode
    ),
    bigPictureControllerLedEnabled: wake.controllerLedEnabled,
    bigPictureControllerLedColor: wake.controllerLedColor,
    bigPictureControllerLedCustomColors: wake.controllerLedCustomColors,
  };
};

function LedSwatchIcon({ hex }: Readonly<{ hex: string }>) {
  return (
    <span
      className="bp-controller-wake__swatch"
      style={{ "--bp-led-swatch": hex } as CSSProperties}
    />
  );
}

export function ControllerWakeSettingsSection() {
  const stagePreferences =
    useSettingsDraft()?.stage ??
    globalThis.window.electron.updateUserPreferences;
  const { t } = useTranslation("big_picture");
  const userPreferences = useUserPreferences();
  const [form, setForm] = useState<ControllerWakeForm>(() =>
    buildForm(userPreferences)
  );

  useEffect(() => {
    if (!userPreferences) return;
    setForm(buildForm(userPreferences));
  }, [userPreferences]);

  const updateUserPreferences = useCallback(
    async (values: Partial<ControllerWakeForm>) => {
      setForm((current) => ({ ...current, ...values }));
      await stagePreferences(values);
    },
    [stagePreferences]
  );

  const wakeModeOptions = useMemo<
    Array<DropdownSelectOption<BigPictureGamepadWakeMode>>
  >(
    () => [
      { value: "home-hold", label: t("settings_wake_mode_home_hold") },
      { value: "home-press", label: t("settings_wake_mode_home_press") },
      { value: "combo", label: t("settings_wake_mode_combo") },
    ],
    [t]
  );

  const homeButtonActionOptions = useMemo<
    Array<DropdownSelectOption<BigPictureHomeButtonAction>>
  >(
    () =>
      BIG_PICTURE_HOME_ACTION_OPTIONS.map((option) => ({
        value: option.value,
        label: t(option.bigPictureLabelKey),
      })),
    [t]
  );

  const gameWindowModeOptions = useMemo<
    Array<DropdownSelectOption<BigPictureGameWindowMode>>
  >(
    () =>
      BIG_PICTURE_GAME_WINDOW_MODE_OPTIONS.map((option) => ({
        value: option.value,
        label: t(option.bigPictureLabelKey),
        description: t(option.descriptionKey),
      })),
    [t]
  );

  const ledColorOptions = useMemo<Array<DropdownSelectOption<string>>>(() => {
    const presetOptions = BIG_PICTURE_CONTROLLER_LED_PRESETS.map((preset) => ({
      value: preset.hex,
      label: t(preset.bigPictureLabelKey),
      icon: <LedSwatchIcon hex={preset.hex} />,
      description: t(preset.descriptionKey),
    }));

    for (const savedHex of form.bigPictureControllerLedCustomColors) {
      presetOptions.push({
        value: savedHex,
        label: t("settings_led_preset_saved_custom", {
          hex: savedHex.toUpperCase(),
        }),
        icon: <LedSwatchIcon hex={savedHex} />,
        description: t("settings_led_preset_saved_custom_desc"),
      });
    }

    const activeHex = form.bigPictureControllerLedColor;
    if (
      !findControllerLedPreset(activeHex) &&
      !form.bigPictureControllerLedCustomColors.includes(activeHex)
    ) {
      presetOptions.push({
        value: activeHex,
        label: t("settings_led_preset_custom", {
          hex: activeHex.toUpperCase(),
        }),
        icon: <LedSwatchIcon hex={activeHex} />,
        description: t("settings_led_preset_custom_desc"),
      });
    }

    return presetOptions;
  }, [
    form.bigPictureControllerLedColor,
    form.bigPictureControllerLedCustomColors,
    t,
  ]);

  const isWindows =
    typeof globalThis.window !== "undefined" &&
    globalThis.window.electron?.platform === "win32";

  const activeHex = form.bigPictureControllerLedColor;
  const idleHex = useMemo(
    () => computeControllerLedIdleHex(activeHex),
    [activeHex]
  );

  const wakeCheckboxOverrides = useMemo<FocusOverrides>(
    () => ({
      down: {
        type: "item",
        itemId: form.bigPictureGamepadWakeEnabled
          ? BIG_PICTURE_WAKE_MODE_SELECT_ID
          : BIG_PICTURE_HOME_BUTTON_ACTION_SELECT_ID,
      },
    }),
    [form.bigPictureGamepadWakeEnabled]
  );

  const wakeModeOverrides = useMemo<FocusOverrides>(
    () => ({
      up: {
        type: "item",
        itemId: BIG_PICTURE_ITEM_FOCUS_IDS.enableGamepadWake,
      },
      down: {
        type: "item",
        itemId: BIG_PICTURE_HOME_BUTTON_ACTION_SELECT_ID,
      },
    }),
    []
  );

  const homeActionOverrides = useMemo<FocusOverrides>(
    () => ({
      up: {
        type: "item",
        itemId: form.bigPictureGamepadWakeEnabled
          ? BIG_PICTURE_WAKE_MODE_SELECT_ID
          : BIG_PICTURE_ITEM_FOCUS_IDS.enableGamepadWake,
      },
      down: {
        type: "item",
        itemId: BIG_PICTURE_GAME_WINDOW_MODE_SELECT_ID,
      },
    }),
    [form.bigPictureGamepadWakeEnabled]
  );

  const gameWindowModeOverrides = useMemo<FocusOverrides>(
    () => ({
      up: {
        type: "item",
        itemId: BIG_PICTURE_HOME_BUTTON_ACTION_SELECT_ID,
      },
      down: isWindows
        ? {
            type: "item",
            itemId: BIG_PICTURE_ITEM_FOCUS_IDS.enableControllerLed,
          }
        : { type: "block" },
    }),
    [isWindows]
  );

  const controllerLedOverrides = useMemo<FocusOverrides>(
    () => ({
      up: {
        type: "item",
        itemId: BIG_PICTURE_GAME_WINDOW_MODE_SELECT_ID,
      },
      down: form.bigPictureControllerLedEnabled
        ? {
            type: "item",
            itemId: BIG_PICTURE_LED_COLOR_SELECT_ID,
          }
        : { type: "block" },
    }),
    [form.bigPictureControllerLedEnabled]
  );

  const ledColorOverrides = useMemo<FocusOverrides>(
    () => ({
      up: {
        type: "item",
        itemId: BIG_PICTURE_ITEM_FOCUS_IDS.enableControllerLed,
      },
      down: { type: "block" },
    }),
    []
  );

  return (
    <SettingsSection
      title={t("settings_controller_wake_section_title")}
      description={t("settings_controller_wake_section_description")}
    >
      <VerticalFocusGroup
        regionId={BIG_PICTURE_CONTROLLER_SECTION_REGION_ID}
        className="bp-controller-wake"
      >
        <div className="bp-advanced__card">
          <div>
            <h3 className="bp-controller-wake__card-title">
              {t("settings_wake_card_title")}
            </h3>
            <p className="bp-controller-wake__card-description">
              {t("settings_wake_card_description")}
            </p>
          </div>

          <div className="big-picture-settings-section__content">
            <Checkbox
              id="enable-gamepad-wake"
              label={t("settings_enable_gamepad_wake")}
              checked={form.bigPictureGamepadWakeEnabled}
              focusId={BIG_PICTURE_ITEM_FOCUS_IDS.enableGamepadWake}
              navigationOverrides={wakeCheckboxOverrides}
              block
              onChange={(checked) =>
                void updateUserPreferences({
                  bigPictureGamepadWakeEnabled: checked,
                })
              }
            />

            <DropdownSelect
              className="big-picture-settings-section__select"
              label={t("settings_wake_mode")}
              value={form.bigPictureGamepadWakeMode}
              options={wakeModeOptions}
              disabled={!form.bigPictureGamepadWakeEnabled}
              focusId={BIG_PICTURE_WAKE_MODE_SELECT_ID}
              focusNavigationOverrides={wakeModeOverrides}
              onValueChange={(mode) =>
                void updateUserPreferences({ bigPictureGamepadWakeMode: mode })
              }
            />

            {form.bigPictureGamepadWakeEnabled &&
              form.bigPictureGamepadWakeMode === "combo" && (
                <p className="bp-controller-wake__combo-note">
                  {t("settings_wake_combo_current")}{" "}
                  <strong>
                    {form.bigPictureGamepadWakeCombo
                      .map((button) => button.toUpperCase())
                      .join(" + ")}
                  </strong>
                </p>
              )}

            <DropdownSelect
              className="big-picture-settings-section__select"
              label={t("settings_home_button_action")}
              value={form.bigPictureHomeButtonAction}
              options={homeButtonActionOptions}
              focusId={BIG_PICTURE_HOME_BUTTON_ACTION_SELECT_ID}
              focusNavigationOverrides={homeActionOverrides}
              onValueChange={(action) =>
                void updateUserPreferences({
                  bigPictureHomeButtonAction: action,
                })
              }
            />

            <DropdownSelect
              className="big-picture-settings-section__select"
              label={t("settings_game_window_mode")}
              value={form.bigPictureGameWindowMode}
              options={gameWindowModeOptions}
              focusId={BIG_PICTURE_GAME_WINDOW_MODE_SELECT_ID}
              focusNavigationOverrides={gameWindowModeOverrides}
              onValueChange={(mode) =>
                void updateUserPreferences({
                  bigPictureGameWindowMode: mode,
                })
              }
            />
          </div>
        </div>

        {isWindows && (
          <div className="bp-advanced__card">
            <div className="bp-controller-wake__card-header">
              <div>
                <h3 className="bp-controller-wake__card-title">
                  {t("settings_led_card_title")}
                </h3>
                <p className="bp-controller-wake__card-description">
                  {t("settings_led_card_description")}
                </p>
              </div>

              <div className="bp-controller-wake__preview" aria-hidden="true">
                <span className="bp-controller-wake__preview-chip">
                  <span
                    className={cn("bp-controller-wake__preview-bar", {
                      "bp-controller-wake__preview-bar--off":
                        !form.bigPictureControllerLedEnabled,
                    })}
                    style={{ "--bp-led-color": idleHex } as CSSProperties}
                  />
                  {t("settings_led_preview_idle")}
                </span>
                <span className="bp-controller-wake__preview-chip">
                  <span
                    className={cn("bp-controller-wake__preview-bar", {
                      "bp-controller-wake__preview-bar--off":
                        !form.bigPictureControllerLedEnabled,
                    })}
                    style={{ "--bp-led-color": activeHex } as CSSProperties}
                  />
                  {t("settings_led_preview_active")}
                </span>
              </div>
            </div>

            <div className="big-picture-settings-section__content">
              <Checkbox
                id="enable-controller-led"
                label={t("settings_enable_controller_led")}
                checked={form.bigPictureControllerLedEnabled}
                focusId={BIG_PICTURE_ITEM_FOCUS_IDS.enableControllerLed}
                navigationOverrides={controllerLedOverrides}
                block
                onChange={(checked) =>
                  void updateUserPreferences({
                    bigPictureControllerLedEnabled: checked,
                  })
                }
              />

              <DropdownSelect
                className="big-picture-settings-section__select"
                label={t("settings_led_color")}
                leadingIcon={<LedSwatchIcon hex={activeHex} />}
                value={activeHex}
                options={ledColorOptions}
                disabled={!form.bigPictureControllerLedEnabled}
                focusId={BIG_PICTURE_LED_COLOR_SELECT_ID}
                focusNavigationOverrides={ledColorOverrides}
                onValueChange={(color) =>
                  void updateUserPreferences({
                    bigPictureControllerLedColor: color,
                  })
                }
              />
            </div>
          </div>
        )}
      </VerticalFocusGroup>
    </SettingsSection>
  );
}
