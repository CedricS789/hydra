import {
  useSettingsDraft,
  useSettingsFormGuard,
} from "@renderer/context/settings/settings-draft.context";
import { useContext, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import { CheckboxField, TextField } from "@renderer/components";
import { settingsContext } from "@renderer/context";
import { useAppSelector } from "@renderer/hooks";
import type { UserPreferences } from "@types";

import "./settings-general.scss";

const formatLimitInputValue = (
  value: number,
  useMegabytes: boolean
): string => {
  const unitValue = useMegabytes ? value / (1024 * 1024) : (value * 8) / 1e6;
  return Number.isInteger(unitValue)
    ? `${unitValue}`
    : `${Number(unitValue.toFixed(2))}`;
};

const buildForm = (preferences: UserPreferences | null) => ({
  showDownloadSpeedInMegabytes:
    preferences?.showDownloadSpeedInMegabytes ?? false,
  extractFilesByDefault: preferences?.extractFilesByDefault ?? true,
  createStartMenuShortcut: preferences?.createStartMenuShortcut ?? true,
  maxDownloadSpeedMegabytes:
    typeof preferences?.maxDownloadSpeedBytesPerSecond === "number" &&
    preferences.maxDownloadSpeedBytesPerSecond > 0
      ? formatLimitInputValue(
          preferences.maxDownloadSpeedBytesPerSecond,
          preferences.showDownloadSpeedInMegabytes ?? false
        )
      : "",
  deleteArchiveFilesAfterExtractionByDefault:
    preferences?.deleteArchiveFilesAfterExtractionByDefault ?? true,
});

export function SettingsContextDownloads() {
  const { t } = useTranslation("settings");
  const draft = useSettingsDraft();
  const { updateUserPreferences: commitUserPreferences } =
    useContext(settingsContext);
  const updateUserPreferences = draft?.stage ?? commitUserPreferences;

  const savedPreferences = useAppSelector(
    (state) => state.userPreferences.value
  );
  const userPreferences = draft?.preferences ?? savedPreferences;

  const parseLimitInputToBytesPerSecond = (
    value: string,
    useMegabytes: boolean
  ): number | null | undefined => {
    const trimmed = value.trim();

    if (!trimmed) return null;

    const parsed = Number(trimmed);
    if (!Number.isFinite(parsed) || parsed < 0) return undefined;
    if (parsed === 0) return null;

    return useMegabytes
      ? Math.floor(parsed * 1024 * 1024)
      : Math.floor((parsed * 1e6) / 8);
  };

  const [form, setForm] = useState(() => buildForm(userPreferences));
  const [speedEditing, setSpeedEditing] = useState(false);
  const [speedError, setSpeedError] = useState("");
  useSettingsFormGuard(
    "download-speed",
    Boolean(speedError),
    "Invalid download speed limit (correct the value)"
  );

  useEffect(() => {
    if (!userPreferences) return;

    setForm((previous) => ({
      ...buildForm(userPreferences),
      ...(speedEditing
        ? { maxDownloadSpeedMegabytes: previous.maxDownloadSpeedMegabytes }
        : {}),
    }));
  }, [userPreferences, speedEditing]);

  const handleChange = (values: Partial<typeof form>) => {
    setForm((prev) => ({ ...prev, ...values }));
    updateUserPreferences(values);
  };

  const handleMaxDownloadSpeedBlur = () => {
    const parsedBytesPerSecond = parseLimitInputToBytesPerSecond(
      form.maxDownloadSpeedMegabytes,
      form.showDownloadSpeedInMegabytes
    );

    if (parsedBytesPerSecond === undefined) {
      setSpeedError(
        "Enter a valid non-negative download limit, or leave it empty for unlimited speed."
      );
      return;
    }
    setSpeedError("");
    setSpeedEditing(false);

    if (parsedBytesPerSecond === null) {
      setForm((prev) => ({ ...prev, maxDownloadSpeedMegabytes: "" }));
      updateUserPreferences({ maxDownloadSpeedBytesPerSecond: null });
      return;
    }

    const nextLimitValue = formatLimitInputValue(
      parsedBytesPerSecond,
      form.showDownloadSpeedInMegabytes
    );
    setForm((prev) => ({ ...prev, maxDownloadSpeedMegabytes: nextLimitValue }));
    updateUserPreferences({
      maxDownloadSpeedBytesPerSecond: parsedBytesPerSecond,
    });
  };

  const handleSpeedUnitChange = () => {
    const nextUseMegabytes = !form.showDownloadSpeedInMegabytes;
    const parsedBytesPerSecond = parseLimitInputToBytesPerSecond(
      form.maxDownloadSpeedMegabytes,
      form.showDownloadSpeedInMegabytes
    );

    const nextLimitInput =
      typeof parsedBytesPerSecond === "number" && parsedBytesPerSecond > 0
        ? formatLimitInputValue(parsedBytesPerSecond, nextUseMegabytes)
        : "";

    setForm((prev) => ({
      ...prev,
      showDownloadSpeedInMegabytes: nextUseMegabytes,
      maxDownloadSpeedMegabytes: nextLimitInput,
    }));

    updateUserPreferences({
      showDownloadSpeedInMegabytes: nextUseMegabytes,
    });
  };

  return (
    <div className="settings-context-panel">
      <div className="settings-context-panel__group">
        <h3>{t("download_behavior")}</h3>

        <TextField
          type="number"
          min="0"
          step="0.1"
          label={t("max_download_speed", {
            unit: form.showDownloadSpeedInMegabytes ? "MB/s" : "Mbps",
          })}
          hint={t("max_download_speed_hint", {
            unit: form.showDownloadSpeedInMegabytes
              ? t("max_download_speed_unit_megabytes")
              : t("max_download_speed_unit_megabits"),
          })}
          value={form.maxDownloadSpeedMegabytes}
          onChange={(event) => {
            const value = event.target.value;
            setForm((prev) => ({
              ...prev,
              maxDownloadSpeedMegabytes: value,
            }));
            const parsed = parseLimitInputToBytesPerSecond(
              value,
              form.showDownloadSpeedInMegabytes
            );
            setSpeedError(
              parsed === undefined
                ? "Enter a valid non-negative download limit."
                : ""
            );
            if (parsed !== undefined)
              void updateUserPreferences({
                maxDownloadSpeedBytesPerSecond: parsed,
              });
          }}
          onFocus={() => setSpeedEditing(true)}
          onBlur={handleMaxDownloadSpeedBlur}
          placeholder={t("max_download_speed_unlimited")}
        />
        {speedError && <p role="alert">{speedError}</p>}

        <CheckboxField
          label={t("extract_files_by_default")}
          checked={form.extractFilesByDefault}
          onChange={() =>
            handleChange({
              extractFilesByDefault: !form.extractFilesByDefault,
            })
          }
        />

        <CheckboxField
          label={t("show_download_speed_in_megabytes")}
          checked={form.showDownloadSpeedInMegabytes}
          onChange={handleSpeedUnitChange}
        />

        <CheckboxField
          label={t("delete_archive_files_after_extraction")}
          checked={form.deleteArchiveFilesAfterExtractionByDefault}
          onChange={() =>
            handleChange({
              deleteArchiveFilesAfterExtractionByDefault:
                !form.deleteArchiveFilesAfterExtractionByDefault,
            })
          }
        />

        {(window.electron.platform === "win32" ||
          window.electron.platform === "linux") && (
          <CheckboxField
            label={t("create_shortcuts_on_download")}
            checked={form.createStartMenuShortcut}
            onChange={() =>
              handleChange({
                createStartMenuShortcut: !form.createStartMenuShortcut,
              })
            }
          />
        )}
      </div>
    </div>
  );
}
