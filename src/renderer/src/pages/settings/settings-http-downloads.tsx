import { useContext, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import {
  Button,
  CheckboxField,
  SelectField,
  TextField,
} from "@renderer/components";
import { settingsContext } from "@renderer/context";
import {
  useSettingsDraft,
  useSettingsFormGuard,
} from "@renderer/context/settings/settings-draft.context";
import { useAppSelector } from "@renderer/hooks";
import {
  HTTP_DOWNLOAD_BOUNDS,
  HTTP_DOWNLOAD_DEFAULTS,
  normalizeHttpRangeSizeMb,
} from "@shared";
import { withResetDefaults } from "../../../../shared/settings-reset";
import type { UserPreferences } from "@types";

interface HttpDownloadFormState {
  httpParallelDownloadsEnabled: boolean;
  httpParallelConnections: number;
  httpRangeSizeMb: number;
  httpStallTimeoutSeconds: string;
  httpCheckpointIntervalSeconds: string;
  httpMaxRetryAttempts: string;
}

const buildForm = (
  preferences: UserPreferences | null
): HttpDownloadFormState => {
  const resolved = withResetDefaults(preferences);
  return {
    httpParallelDownloadsEnabled:
      resolved.httpParallelDownloadsEnabled ??
      HTTP_DOWNLOAD_DEFAULTS.httpParallelDownloadsEnabled,
    httpParallelConnections:
      typeof resolved.httpParallelConnections === "number"
        ? Math.min(
            HTTP_DOWNLOAD_BOUNDS.parallelConnections.uiMax,
            Math.max(
              HTTP_DOWNLOAD_BOUNDS.parallelConnections.min,
              Math.round(resolved.httpParallelConnections)
            )
          )
        : HTTP_DOWNLOAD_DEFAULTS.httpParallelConnections,
    httpRangeSizeMb: normalizeHttpRangeSizeMb(resolved.httpRangeSizeMb),
    httpStallTimeoutSeconds: String(
      resolved.httpStallTimeoutSeconds ??
        HTTP_DOWNLOAD_DEFAULTS.httpStallTimeoutSeconds
    ),
    httpCheckpointIntervalSeconds: String(
      resolved.httpCheckpointIntervalSeconds ??
        HTTP_DOWNLOAD_DEFAULTS.httpCheckpointIntervalSeconds
    ),
    httpMaxRetryAttempts: String(
      resolved.httpMaxRetryAttempts ??
        HTTP_DOWNLOAD_DEFAULTS.httpMaxRetryAttempts
    ),
  };
};

const parseBoundedInteger = (
  raw: string,
  min: number,
  max: number
): number | null => {
  const trimmed = raw.trim();
  if (!trimmed || !/^\d+$/.test(trimmed)) return null;
  const parsed = Number(trimmed);
  if (!Number.isSafeInteger(parsed) || parsed < min || parsed > max) {
    return null;
  }
  return parsed;
};

export function SettingsHttpDownloads() {
  const { t } = useTranslation("settings");
  const draft = useSettingsDraft();
  const { updateUserPreferences: commitUserPreferences } =
    useContext(settingsContext);
  const updateUserPreferences = draft?.stage ?? commitUserPreferences;

  const savedPreferences = useAppSelector(
    (state) => state.userPreferences.value
  );
  const userPreferences = draft?.preferences ?? savedPreferences;

  const [form, setForm] = useState<HttpDownloadFormState>(() =>
    buildForm(userPreferences)
  );
  const [editingField, setEditingField] = useState<string | null>(null);
  const [errors, setErrors] = useState<{
    stall?: string;
    checkpoint?: string;
    retries?: string;
  }>({});

  const hasValidationError = Boolean(
    errors.stall || errors.checkpoint || errors.retries
  );
  useSettingsFormGuard(
    "http-downloads",
    hasValidationError,
    t("http_downloads_invalid_form")
  );

  useEffect(() => {
    if (!userPreferences) return;
    const next = buildForm(userPreferences);
    setForm((prev) => ({
      ...next,
      ...(editingField === "stall"
        ? { httpStallTimeoutSeconds: prev.httpStallTimeoutSeconds }
        : {}),
      ...(editingField === "checkpoint"
        ? { httpCheckpointIntervalSeconds: prev.httpCheckpointIntervalSeconds }
        : {}),
      ...(editingField === "retries"
        ? { httpMaxRetryAttempts: prev.httpMaxRetryAttempts }
        : {}),
    }));
  }, [userPreferences, editingField]);

  const connectionOptions = Array.from(
    { length: HTTP_DOWNLOAD_BOUNDS.parallelConnections.uiMax },
    (_, index) => {
      const value = index + 1;
      return {
        key: String(value),
        value: String(value),
        label:
          value === HTTP_DOWNLOAD_BOUNDS.parallelConnections.defaultValue
            ? t("http_connections_default", { count: value })
            : t("http_connections_count", { count: value }),
      };
    }
  );

  const rangeSizeOptions = HTTP_DOWNLOAD_BOUNDS.rangeSizeMb.presets.map(
    (sizeMb) => ({
      key: String(sizeMb),
      value: String(sizeMb),
      label:
        sizeMb === 0
          ? t("http_range_size_auto")
          : t("http_range_size_mb", { size: sizeMb }),
    })
  );

  const handleNumericChange = (
    field: "stall" | "checkpoint" | "retries",
    formKey:
      | "httpStallTimeoutSeconds"
      | "httpCheckpointIntervalSeconds"
      | "httpMaxRetryAttempts",
    raw: string,
    bounds: { min: number; max: number },
    errorText: string
  ) => {
    setForm((prev) => ({ ...prev, [formKey]: raw }));
    const parsed = parseBoundedInteger(raw, bounds.min, bounds.max);
    setErrors((prev) => ({
      ...prev,
      [field]: parsed === null ? errorText : undefined,
    }));
    if (parsed !== null) {
      void updateUserPreferences({ [formKey]: parsed });
    }
  };

  const handleRestoreDefaults = () => {
    setErrors({});
    setEditingField(null);
    setForm(buildForm({ ...userPreferences, ...HTTP_DOWNLOAD_DEFAULTS }));
    void updateUserPreferences({ ...HTTP_DOWNLOAD_DEFAULTS });
  };

  return (
    <div className="settings-general">
      <CheckboxField
        label={t("http_parallel_downloads_enabled")}
        checked={form.httpParallelDownloadsEnabled}
        onChange={() => {
          const next = !form.httpParallelDownloadsEnabled;
          setForm((prev) => ({ ...prev, httpParallelDownloadsEnabled: next }));
          void updateUserPreferences({ httpParallelDownloadsEnabled: next });
        }}
      />
      <p className="settings-context-advanced__hint">
        {t("http_parallel_downloads_hint")}
      </p>

      <SelectField
        label={t("http_parallel_connections_label")}
        value={String(form.httpParallelConnections)}
        disabled={!form.httpParallelDownloadsEnabled}
        onChange={(event) => {
          const parsed = Number(event.target.value);
          if (!Number.isFinite(parsed)) return;
          setForm((prev) => ({ ...prev, httpParallelConnections: parsed }));
          void updateUserPreferences({ httpParallelConnections: parsed });
        }}
        options={connectionOptions}
      />

      <SelectField
        label={t("http_range_size_label")}
        value={String(form.httpRangeSizeMb)}
        disabled={!form.httpParallelDownloadsEnabled}
        onChange={(event) => {
          const parsed = normalizeHttpRangeSizeMb(Number(event.target.value));
          setForm((prev) => ({ ...prev, httpRangeSizeMb: parsed }));
          void updateUserPreferences({ httpRangeSizeMb: parsed });
        }}
        options={rangeSizeOptions}
      />
      <p className="settings-context-advanced__hint">
        {t("http_range_size_hint")}
      </p>

      <TextField
        type="number"
        min={HTTP_DOWNLOAD_BOUNDS.stallTimeoutSeconds.min}
        max={HTTP_DOWNLOAD_BOUNDS.stallTimeoutSeconds.max}
        step="1"
        label={t("http_stall_timeout_label")}
        hint={t("http_stall_timeout_hint", {
          min: HTTP_DOWNLOAD_BOUNDS.stallTimeoutSeconds.min,
          max: HTTP_DOWNLOAD_BOUNDS.stallTimeoutSeconds.max,
        })}
        value={form.httpStallTimeoutSeconds}
        onFocus={() => setEditingField("stall")}
        onBlur={() => setEditingField(null)}
        onChange={(event) =>
          handleNumericChange(
            "stall",
            "httpStallTimeoutSeconds",
            event.target.value,
            HTTP_DOWNLOAD_BOUNDS.stallTimeoutSeconds,
            t("http_stall_timeout_error", {
              min: HTTP_DOWNLOAD_BOUNDS.stallTimeoutSeconds.min,
              max: HTTP_DOWNLOAD_BOUNDS.stallTimeoutSeconds.max,
            })
          )
        }
      />
      {errors.stall && <p role="alert">{errors.stall}</p>}

      <TextField
        type="number"
        min={HTTP_DOWNLOAD_BOUNDS.checkpointIntervalSeconds.min}
        max={HTTP_DOWNLOAD_BOUNDS.checkpointIntervalSeconds.max}
        step="1"
        label={t("http_checkpoint_interval_label")}
        hint={t("http_checkpoint_interval_hint", {
          min: HTTP_DOWNLOAD_BOUNDS.checkpointIntervalSeconds.min,
          max: HTTP_DOWNLOAD_BOUNDS.checkpointIntervalSeconds.max,
        })}
        value={form.httpCheckpointIntervalSeconds}
        onFocus={() => setEditingField("checkpoint")}
        onBlur={() => setEditingField(null)}
        onChange={(event) =>
          handleNumericChange(
            "checkpoint",
            "httpCheckpointIntervalSeconds",
            event.target.value,
            HTTP_DOWNLOAD_BOUNDS.checkpointIntervalSeconds,
            t("http_checkpoint_interval_error", {
              min: HTTP_DOWNLOAD_BOUNDS.checkpointIntervalSeconds.min,
              max: HTTP_DOWNLOAD_BOUNDS.checkpointIntervalSeconds.max,
            })
          )
        }
      />
      {errors.checkpoint && <p role="alert">{errors.checkpoint}</p>}

      <TextField
        type="number"
        min={HTTP_DOWNLOAD_BOUNDS.maxRetryAttempts.min}
        max={HTTP_DOWNLOAD_BOUNDS.maxRetryAttempts.max}
        step="1"
        label={t("http_max_retries_label")}
        hint={t("http_max_retries_hint", {
          min: HTTP_DOWNLOAD_BOUNDS.maxRetryAttempts.min,
          max: HTTP_DOWNLOAD_BOUNDS.maxRetryAttempts.max,
        })}
        value={form.httpMaxRetryAttempts}
        onFocus={() => setEditingField("retries")}
        onBlur={() => setEditingField(null)}
        onChange={(event) =>
          handleNumericChange(
            "retries",
            "httpMaxRetryAttempts",
            event.target.value,
            HTTP_DOWNLOAD_BOUNDS.maxRetryAttempts,
            t("http_max_retries_error", {
              min: HTTP_DOWNLOAD_BOUNDS.maxRetryAttempts.min,
              max: HTTP_DOWNLOAD_BOUNDS.maxRetryAttempts.max,
            })
          )
        }
      />
      {errors.retries && <p role="alert">{errors.retries}</p>}

      <div className="settings-context-advanced__actions">
        <Button type="button" theme="outline" onClick={handleRestoreDefaults}>
          {t("http_restore_defaults")}
        </Button>
      </div>
    </div>
  );
}
