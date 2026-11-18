import {
  addControllerLedCustomColor,
  BIG_PICTURE_CONTROLLER_LED_PRESETS,
  BIG_PICTURE_GAME_WINDOW_MODE_OPTIONS,
  BIG_PICTURE_HOME_ACTION_OPTIONS,
  computeControllerLedIdleHex,
  DEFAULT_BIG_PICTURE_CONTROLLER_LED_COLOR,
  DEFAULT_BIG_PICTURE_GAMEPAD_WAKE_COMBO,
  findControllerLedPreset,
  MAX_BIG_PICTURE_CONTROLLER_LED_CUSTOM_COLORS,
  normalizeBigPictureGameWindowMode,
  normalizeControllerLedColor,
  removeControllerLedCustomColor,
  resolveBigPictureGamepadWakeSettings,
} from "@shared";
import { useSettingsDraft } from "@renderer/context/settings/settings-draft.context";
import cn from "classnames";
import {
  type CSSProperties,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { useTranslation } from "react-i18next";

import { Button, CheckboxField, SelectField } from "@renderer/components";
import { settingsContext } from "@renderer/context";
import { useAppSelector } from "@renderer/hooks";
import type {
  BigPictureGameWindowMode,
  BigPictureGamepadWakeMode,
  BigPictureGamepadWakeStatus,
  BigPictureHomeButtonAction,
  ScreenshotGamepadButton,
  UserPreferences,
} from "@types";
import { SettingsScreenshotsGamepad } from "./settings-screenshots-gamepad";

import "./settings-controller-wake.scss";

const buildForm = (preferences: UserPreferences | null) => {
  const wake = resolveBigPictureGamepadWakeSettings(preferences);
  return {
    bigPictureGamepadWakeEnabled: wake.enabled,
    bigPictureGamepadWakeMode: wake.mode,
    bigPictureGamepadWakeCombo: wake.combo,
    bigPictureHomeButtonAction: wake.homeButtonAction,
    bigPictureGameWindowMode: normalizeBigPictureGameWindowMode(
      preferences?.bigPictureGameWindowMode
    ),
    bigPictureControllerLedEnabled: wake.controllerLedEnabled,
    bigPictureControllerLedColor: wake.controllerLedColor,
    bigPictureControllerLedCustomColors: wake.controllerLedCustomColors,
  };
};

const HEX_COLOR_INPUT_PATTERN = /^#?[0-9a-f]{6}$/i;

export function SettingsControllerWake() {
  const { t } = useTranslation("settings");
  const draft = useSettingsDraft();
  const { updateUserPreferences: commitUserPreferences } =
    useContext(settingsContext);
  const updateUserPreferences = draft?.stage ?? commitUserPreferences;

  const savedPreferences = useAppSelector(
    (state) => state.userPreferences.value
  );
  const userPreferences = draft?.preferences ?? savedPreferences;

  const [form, setForm] = useState(() => buildForm(userPreferences));
  const [hexDraft, setHexDraft] = useState(() =>
    buildForm(userPreferences).bigPictureControllerLedColor.toUpperCase()
  );
  const [wakeStatus, setWakeStatus] =
    useState<BigPictureGamepadWakeStatus | null>(null);

  useEffect(() => {
    if (!userPreferences) return;
    const next = buildForm(userPreferences);
    setForm(next);
    setHexDraft(next.bigPictureControllerLedColor.toUpperCase());
  }, [userPreferences]);

  useEffect(() => {
    let active = true;
    void window.electron
      .getBigPictureGamepadWakeStatus?.()
      .then((status) => {
        if (active && status) setWakeStatus(status);
      })
      .catch(() => {});

    const unsubscribe = window.electron.onBigPictureGamepadWakeStatusChange?.(
      (status) => {
        if (active) setWakeStatus(status);
      }
    );

    return () => {
      active = false;
      unsubscribe?.();
    };
  }, []);

  const handleChange = (values: Partial<typeof form>) => {
    setForm((prev) => ({ ...prev, ...values }));
    if (values.bigPictureControllerLedColor) {
      setHexDraft(values.bigPictureControllerLedColor.toUpperCase());
    }
    updateUserPreferences(values);
  };

  const handleHexDraftChange = (raw: string) => {
    setHexDraft(raw.toUpperCase());
    if (HEX_COLOR_INPUT_PATTERN.test(raw.trim())) {
      const normalized = normalizeControllerLedColor(raw);
      setForm((prev) => ({
        ...prev,
        bigPictureControllerLedColor: normalized,
      }));
      updateUserPreferences({ bigPictureControllerLedColor: normalized });
    }
  };

  const handleHexDraftBlur = () => {
    setHexDraft(form.bigPictureControllerLedColor.toUpperCase());
  };

  const wakeModeOptions = useMemo(
    () =>
      [
        {
          key: "home-hold",
          value: "home-hold",
          label: t("big_picture_wake_mode_home_hold"),
        },
        {
          key: "home-press",
          value: "home-press",
          label: t("big_picture_wake_mode_home_press"),
        },
        {
          key: "combo",
          value: "combo",
          label: t("big_picture_wake_mode_combo"),
        },
      ] as Array<{
        key: string;
        value: BigPictureGamepadWakeMode;
        label: string;
      }>,
    [t]
  );

  const homeButtonActionOptions = useMemo(
    () =>
      BIG_PICTURE_HOME_ACTION_OPTIONS.map((option) => ({
        key: option.value,
        value: option.value,
        label: t(option.desktopLabelKey),
      })),
    [t]
  );

  const gameWindowModeOptions = useMemo(
    () =>
      BIG_PICTURE_GAME_WINDOW_MODE_OPTIONS.map((option) => ({
        key: option.value,
        value: option.value,
        label: t(option.desktopLabelKey),
      })),
    [t]
  );

  const isWindows = window.electron.platform === "win32";
  const needsBackgroundStartup =
    !userPreferences?.runAtStartup || !userPreferences?.startMinimized;
  const activeHex = form.bigPictureControllerLedColor;
  const idleHex = useMemo(
    () => computeControllerLedIdleHex(activeHex),
    [activeHex]
  );
  const isDefaultLedColor =
    activeHex === DEFAULT_BIG_PICTURE_CONTROLLER_LED_COLOR;
  const savedCustomColors = form.bigPictureControllerLedCustomColors;
  const canSaveCustomColor =
    !findControllerLedPreset(activeHex) &&
    !savedCustomColors.includes(activeHex) &&
    savedCustomColors.length < MAX_BIG_PICTURE_CONTROLLER_LED_CUSTOM_COLORS;

  const handleSaveCustomColor = () => {
    const nextCustomColors = addControllerLedCustomColor(
      savedCustomColors,
      activeHex
    );
    handleChange({
      bigPictureControllerLedColor: activeHex,
      bigPictureControllerLedCustomColors: nextCustomColors,
    });
  };

  const handleRemoveCustomColor = (hex: string) => {
    const nextCustomColors = removeControllerLedCustomColor(
      savedCustomColors,
      hex
    );
    handleChange({ bigPictureControllerLedCustomColors: nextCustomColors });
  };

  return (
    <div className="settings-controller-wake">
      {(wakeStatus ||
        (form.bigPictureGamepadWakeEnabled && needsBackgroundStartup)) && (
        <div className="settings-controller-wake__toolbar">
          {wakeStatus && (
            <span
              className={cn("settings-controller-wake__status-pill", {
                "settings-controller-wake__status-pill--active":
                  wakeStatus.active &&
                  wakeStatus.hint !== "gamepad_unavailable",
                "settings-controller-wake__status-pill--unavailable":
                  wakeStatus.hint === "gamepad_unavailable",
              })}
              role="status"
            >
              <span
                className="settings-controller-wake__status-dot"
                aria-hidden="true"
              />
              {wakeStatus.hint === "gamepad_unavailable"
                ? t("big_picture_wake_status_unavailable")
                : wakeStatus.active
                  ? t("big_picture_wake_status_active", {
                      backend: wakeStatus.gamepadBackend,
                    })
                  : t("big_picture_wake_status_inactive")}
            </span>
          )}

          {form.bigPictureGamepadWakeEnabled && needsBackgroundStartup && (
            <Button
              theme="outline"
              size="small"
              onClick={() =>
                void updateUserPreferences({
                  runAtStartup: true,
                  startMinimized: true,
                })
              }
            >
              {t("big_picture_enable_background_startup")}
            </Button>
          )}
        </div>
      )}

      <section className="settings-controller-wake__card">
        <div className="settings-controller-wake__card-header">
          <div>
            <h4>{t("big_picture_wake_card_title")}</h4>
            <p>{t("big_picture_wake_card_description")}</p>
          </div>
        </div>

        <CheckboxField
          label={t("big_picture_enable_gamepad_wake")}
          checked={form.bigPictureGamepadWakeEnabled}
          onChange={() =>
            handleChange({
              bigPictureGamepadWakeEnabled: !form.bigPictureGamepadWakeEnabled,
            })
          }
        />

        <div className="settings-controller-wake__grid">
          <SelectField
            label={t("big_picture_wake_mode")}
            value={form.bigPictureGamepadWakeMode}
            onChange={(e) =>
              handleChange({
                bigPictureGamepadWakeMode: e.target
                  .value as BigPictureGamepadWakeMode,
              })
            }
            options={wakeModeOptions}
            disabled={!form.bigPictureGamepadWakeEnabled}
          />

          <SelectField
            label={t("big_picture_home_button_action")}
            value={form.bigPictureHomeButtonAction}
            onChange={(e) =>
              handleChange({
                bigPictureHomeButtonAction: e.target
                  .value as BigPictureHomeButtonAction,
              })
            }
            options={homeButtonActionOptions}
          />
        </div>

        <div className="settings-controller-wake__inset">
          <SelectField
            label={t("big_picture_game_window_mode")}
            value={form.bigPictureGameWindowMode}
            onChange={(e) =>
              handleChange({
                bigPictureGameWindowMode: e.target
                  .value as BigPictureGameWindowMode,
              })
            }
            options={gameWindowModeOptions}
          />
          <small className="settings-context-advanced__hint">
            {t("big_picture_game_window_mode_hint")}
          </small>
        </div>

        {form.bigPictureGamepadWakeMode === "combo" && (
          <div className="settings-controller-wake__inset">
            <SettingsScreenshotsGamepad
              combo={form.bigPictureGamepadWakeCombo}
              disabled={!form.bigPictureGamepadWakeEnabled}
              label={t("big_picture_wake_combo_label")}
              hint={t("big_picture_wake_combo_hint")}
              defaultCombo={DEFAULT_BIG_PICTURE_GAMEPAD_WAKE_COMBO}
              onChange={(combo: ScreenshotGamepadButton[]) =>
                handleChange({ bigPictureGamepadWakeCombo: combo })
              }
            />
          </div>
        )}

        {isWindows && form.bigPictureGamepadWakeEnabled && (
          <div className="settings-controller-wake__advisory-row">
            <small>{t("big_picture_wake_windows_advisory")}</small>
            <Button
              theme="outline"
              size="small"
              onClick={() =>
                void window.electron.openWindowsGameBarSettings?.()
              }
            >
              {t("big_picture_open_game_bar_settings")}
            </Button>
          </div>
        )}
      </section>

      {isWindows && (
        <section className="settings-controller-wake__card">
          <div className="settings-controller-wake__card-header">
            <div>
              <h4>{t("big_picture_led_card_title")}</h4>
              <p>{t("big_picture_led_card_description")}</p>
            </div>

            <div
              className="settings-controller-wake__lightbar-preview"
              aria-hidden="true"
            >
              <span className="settings-controller-wake__lightbar-chip">
                <span
                  className={cn("settings-controller-wake__lightbar-glow", {
                    "settings-controller-wake__lightbar-glow--off":
                      !form.bigPictureControllerLedEnabled,
                  })}
                  style={
                    {
                      "--led-preview-color": idleHex,
                    } as CSSProperties
                  }
                />
                {t("big_picture_led_preview_idle")}
              </span>
              <span className="settings-controller-wake__lightbar-chip">
                <span
                  className={cn("settings-controller-wake__lightbar-glow", {
                    "settings-controller-wake__lightbar-glow--off":
                      !form.bigPictureControllerLedEnabled,
                  })}
                  style={
                    {
                      "--led-preview-color": activeHex,
                    } as CSSProperties
                  }
                />
                {t("big_picture_led_preview_active")}
              </span>
            </div>
          </div>

          <CheckboxField
            label={t("big_picture_enable_controller_led")}
            checked={form.bigPictureControllerLedEnabled}
            onChange={() =>
              handleChange({
                bigPictureControllerLedEnabled:
                  !form.bigPictureControllerLedEnabled,
              })
            }
          />

          <div
            className={cn("settings-controller-wake__swatches", {
              "settings-controller-wake__swatches--disabled":
                !form.bigPictureControllerLedEnabled,
            })}
            role="radiogroup"
            aria-label={t("big_picture_led_color_presets")}
          >
            {BIG_PICTURE_CONTROLLER_LED_PRESETS.map((preset) => {
              const selected = activeHex === preset.hex;
              return (
                <button
                  key={preset.id}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  disabled={!form.bigPictureControllerLedEnabled}
                  className={cn("settings-controller-wake__swatch", {
                    "settings-controller-wake__swatch--selected": selected,
                  })}
                  onClick={() =>
                    handleChange({ bigPictureControllerLedColor: preset.hex })
                  }
                >
                  <span
                    className="settings-controller-wake__swatch-dot"
                    style={{ "--swatch-color": preset.hex } as CSSProperties}
                    aria-hidden="true"
                  />
                  <span className="settings-controller-wake__swatch-label">
                    {t(preset.labelKey)}
                  </span>
                </button>
              );
            })}
          </div>

          {savedCustomColors.length > 0 && (
            <div
              className={cn("settings-controller-wake__saved-group", {
                "settings-controller-wake__saved-group--disabled":
                  !form.bigPictureControllerLedEnabled,
              })}
            >
              <span className="settings-controller-wake__saved-title">
                {t("big_picture_led_saved_colors")}
              </span>
              <div className="settings-controller-wake__saved-list">
                {savedCustomColors.map((hex) => {
                  const selected = activeHex === hex;
                  return (
                    <div
                      key={hex}
                      className={cn("settings-controller-wake__saved-chip", {
                        "settings-controller-wake__saved-chip--selected":
                          selected,
                      })}
                    >
                      <button
                        type="button"
                        disabled={!form.bigPictureControllerLedEnabled}
                        className="settings-controller-wake__saved-select"
                        aria-pressed={selected}
                        onClick={() =>
                          handleChange({ bigPictureControllerLedColor: hex })
                        }
                      >
                        <span
                          className="settings-controller-wake__swatch-dot"
                          style={{ "--swatch-color": hex } as CSSProperties}
                          aria-hidden="true"
                        />
                        <span>{hex.toUpperCase()}</span>
                      </button>
                      <button
                        type="button"
                        disabled={!form.bigPictureControllerLedEnabled}
                        className="settings-controller-wake__saved-remove"
                        aria-label={t("big_picture_led_remove_saved_color", {
                          hex: hex.toUpperCase(),
                        })}
                        onClick={() => handleRemoveCustomColor(hex)}
                      >
                        ×
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          <div
            className={cn("settings-controller-wake__custom-color", {
              "settings-controller-wake__custom-color--disabled":
                !form.bigPictureControllerLedEnabled,
            })}
          >
            <div className="settings-controller-wake__custom-color-controls">
              <span className="settings-controller-wake__custom-color-label">
                {t("big_picture_led_custom_color")}
              </span>
              <input
                type="color"
                aria-label={t("big_picture_led_custom_color")}
                className="settings-controller-wake__color-picker"
                value={activeHex}
                disabled={!form.bigPictureControllerLedEnabled}
                onChange={(e) =>
                  handleChange({
                    bigPictureControllerLedColor: normalizeControllerLedColor(
                      e.target.value
                    ),
                  })
                }
              />
              <input
                type="text"
                aria-label={t("big_picture_led_hex_label")}
                className="settings-controller-wake__hex-input"
                value={hexDraft}
                maxLength={7}
                disabled={!form.bigPictureControllerLedEnabled}
                onChange={(e) => handleHexDraftChange(e.target.value)}
                onBlur={handleHexDraftBlur}
              />
            </div>

            <div className="settings-controller-wake__custom-color-actions">
              <Button
                theme="outline"
                size="small"
                disabled={
                  !form.bigPictureControllerLedEnabled || !canSaveCustomColor
                }
                onClick={handleSaveCustomColor}
              >
                {t("big_picture_led_save_custom_color")}
              </Button>

              {!isDefaultLedColor && (
                <Button
                  theme="outline"
                  size="small"
                  disabled={!form.bigPictureControllerLedEnabled}
                  onClick={() =>
                    handleChange({
                      bigPictureControllerLedColor:
                        DEFAULT_BIG_PICTURE_CONTROLLER_LED_COLOR,
                    })
                  }
                >
                  {t("big_picture_led_reset_color")}
                </Button>
              )}
            </div>
          </div>

          <p className="settings-controller-wake__note">
            {t("big_picture_led_behavior_note")}
          </p>
        </section>
      )}
    </div>
  );
}
