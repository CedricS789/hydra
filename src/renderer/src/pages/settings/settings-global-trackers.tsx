import { useSettingsOperationGuard } from "@renderer/context/settings/settings-draft.context";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useAppDispatch, useAppSelector } from "@renderer/hooks";
import { useForm } from "react-hook-form";
import { Button, CheckboxField } from "@renderer/components";
import { setUserPreferences } from "@renderer/features";
import { parseTrackerList } from "@shared";
import { useSettingsFormGuard } from "@renderer/context/settings/settings-draft.context";
import "./settings-global-trackers.scss";

export function SettingsGlobalTrackers() {
  const { t } = useTranslation("settings");
  const dispatch = useAppDispatch();
  const preferences = useAppSelector((state) => state.userPreferences.value);
  const { register, setValue, watch } = useForm({
    defaultValues: { manualTrackers: "" },
  });
  const manualText = watch("manualTrackers");
  const [trackerUrl, setTrackerUrl] = useState("");
  const [appendManual, setAppendManual] = useState(false);
  const [appendUrl, setAppendUrl] = useState(false);
  const [initial, setInitial] = useState<string>();
  const [working, setWorking] = useState(false);
  useSettingsOperationGuard("settings-global-trackers", working);
  const [saveError, setSaveError] = useState<string | null>(null);
  const snapshot = JSON.stringify([
    manualText,
    trackerUrl,
    appendManual,
    appendUrl,
  ]);
  const dirty = initial !== undefined && snapshot !== initial;
  useSettingsFormGuard("trackers", dirty, "Torrent tracker settings");
  useEffect(() => {
    if (!preferences || initial !== undefined) return;
    const manual = (preferences.globalTrackers ?? []).join("\n");
    const url = preferences.globalTrackersUrl ?? "";
    const am = preferences.appendGlobalTrackers ?? false;
    const au = preferences.appendGlobalTrackersUrl ?? false;
    setValue("manualTrackers", manual);
    setTrackerUrl(url);
    setAppendManual(am);
    setAppendUrl(au);
    setInitial(JSON.stringify([manual, url, am, au]));
  }, [preferences, initial, setValue]);
  const save = async () => {
    if (working) return;
    setWorking(true);
    setSaveError(null);
    try {
      if (
        !(await window.electron.confirmSettingsChanges("save", [
          "Change global torrent trackers. Tracker servers can see information about direct torrent activity. This does not enable direct torrents by itself.",
        ]))
      )
        return;
      await window.electron.saveGlobalTrackers(
        parseTrackerList(manualText),
        trackerUrl || null,
        appendManual,
        appendUrl
      );
      const latest = await window.electron.getUserPreferences();
      dispatch(setUserPreferences(latest));
      setInitial(snapshot);
    } catch (error) {
      setSaveError(
        error instanceof Error ? error.message : t("global_trackers_save_error")
      );
    } finally {
      setWorking(false);
    }
  };
  const handleToggleManual = () => setAppendManual((value) => !value);
  const handleToggleUrl = () => setAppendUrl((value) => !value);
  const handleUrlChange = setTrackerUrl;

  return (
    <form
      className="settings-global-trackers"
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
    >
      <p className="settings-global-trackers__description">
        {t("global_trackers_description")}
      </p>

      {saveError && (
        <p className="settings-global-trackers__error">{saveError}</p>
      )}

      <div className="settings-global-trackers__section">
        <CheckboxField
          label={t("global_trackers_append_manual")}
          checked={appendManual}
          onChange={handleToggleManual}
        />
        <div
          className={`settings-global-trackers__section-content ${
            appendManual
              ? ""
              : "settings-global-trackers__section-content--disabled"
          }`}
        >
          <textarea
            {...register("manualTrackers")}
            className="settings-global-trackers__textarea"
            placeholder={t("global_trackers_manual_placeholder")}
            rows={5}
            disabled={!appendManual}
          />
        </div>
      </div>

      <div className="settings-global-trackers__section">
        <CheckboxField
          label={t("global_trackers_append_url")}
          checked={appendUrl}
          onChange={handleToggleUrl}
        />
        <div
          className={`settings-global-trackers__section-content ${
            appendUrl
              ? ""
              : "settings-global-trackers__section-content--disabled"
          }`}
        >
          <input
            className="settings-global-trackers__url-input"
            type="text"
            value={trackerUrl}
            onChange={(e) => handleUrlChange(e.target.value)}
            placeholder={t("global_trackers_url_placeholder")}
            disabled={!appendUrl}
          />
        </div>
      </div>
      <Button type="submit" disabled={!dirty || working}>
        {working ? "Please wait…" : "Save tracker settings"}
      </Button>
    </form>
  );
}
