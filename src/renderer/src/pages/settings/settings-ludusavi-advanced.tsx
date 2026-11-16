import {
  useSettingsOperationGuard,
  useSettingsConfirmation,
} from "@renderer/context/settings/settings-draft.context";
import { useSettingsFormGuard } from "@renderer/context/settings/settings-draft.context";
import { settingsValueEqual } from "../../../../shared/settings-changes";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import { Button, CheckboxField, TextField } from "@renderer/components";
import { useLudusaviLocalState } from "@renderer/hooks";
import type { LudusaviGameSettings, LudusaviLocalSettings } from "@types";
import { SettingsSaveManager } from "./settings-save-manager";
import saveEngine from "../../../../shared/save-engine.json";
import "./settings-local-edition.scss";

const emptyGameSettings: LudusaviGameSettings = {
  enabled: true,
  savePaths: [] as string[],
  trackingPaths: [] as string[],
};

export function SettingsLudusaviAdvanced() {
  const confirm = useSettingsConfirmation();
  const { t } = useTranslation("ludusavi");
  const { state, error: stateError, refresh } = useLudusaviLocalState();
  const [settings, setSettings] = useState<LudusaviLocalSettings>();
  const [savedSettings, setSavedSettings] = useState<LudusaviLocalSettings>();
  const [advancedGameKey, setAdvancedGameKey] = useState("");
  const [savePathsText, setSavePathsText] = useState("");
  const [trackingPathsText, setTrackingPathsText] = useState("");
  const [pathsAcknowledged, setPathsAcknowledged] = useState(false);
  const [retentionAcknowledged, setRetentionAcknowledged] = useState(false);
  const [pendingUnlink, setPendingUnlink] = useState(false);
  const [unlinkAcknowledged, setUnlinkAcknowledged] = useState(false);
  const [working, setWorking] = useState(false);
  useSettingsOperationGuard("settings-ludusavi-advanced", working);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [pendingDisable, setPendingDisable] = useState<
    "global" | { gameKey: string; title: string } | null
  >(null);
  const [disableAcknowledged, setDisableAcknowledged] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);
  const [clearNotice, setClearNotice] = useState("");

  const settingsDirty = Boolean(
    settings && savedSettings && !settingsValueEqual(settings, savedSettings)
  );
  useEffect(() => {
    if (state && !settingsDirty) {
      setSettings(state.settings);
      setSavedSettings(state.settings);
    }
  }, [state, settingsDirty]);

  useEffect(() => {
    if (stateError) setError(stateError);
  }, [stateError]);

  useEffect(() => {
    if (!state?.games.length) {
      setAdvancedGameKey("");
      return;
    }
    if (!state.games.some((game) => game.key === advancedGameKey)) {
      setAdvancedGameKey(state.games[0].key);
    }
  }, [state?.games, advancedGameKey]);

  const advancedGame = state?.games.find(
    (game) => game.key === advancedGameKey
  );
  const advancedGameSettings =
    settings?.games[advancedGameKey] ?? emptyGameSettings;
  const parsePathLines = (value: string) =>
    value
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);
  const pathsDirty = Boolean(
    advancedGame &&
      (!settingsValueEqual(
        parsePathLines(savePathsText),
        advancedGameSettings.savePaths
      ) ||
        !settingsValueEqual(
          parsePathLines(trackingPathsText),
          advancedGameSettings.trackingPaths
        ))
  );
  useSettingsFormGuard(
    "backup-advanced",
    settingsDirty || pathsDirty,
    "Advanced save backup settings"
  );

  useEffect(() => {
    if (!advancedGame || pathsDirty) return;
    setSavePathsText(advancedGameSettings.savePaths.join("\n"));
    setTrackingPathsText(advancedGameSettings.trackingPaths.join("\n"));
  }, [
    advancedGameKey,
    advancedGame,
    advancedGameSettings.savePaths,
    advancedGameSettings.trackingPaths,
    pathsDirty,
  ]);

  const update = (value: Partial<LudusaviLocalSettings>) =>
    setSettings((current) => (current ? { ...current, ...value } : current));

  const action = async (task: () => Promise<unknown>, saving = false) => {
    if (!saving && (settingsDirty || pathsDirty)) {
      setError(
        "Save or discard your backup settings edits before running another operation."
      );
      return;
    }
    setWorking(true);
    setError("");
    setNotice("");
    try {
      await task();
      const latest = await refresh();
      setSettings(latest.settings);
      setSavedSettings(latest.settings);
    } catch (e) {
      setError(String(e));
    } finally {
      setWorking(false);
    }
  };

  if (!settings || !state) {
    return (
      <section className="local-edition local-edition--backups">
        <p role={error ? "alert" : "status"}>{error || t("loading")}</p>
      </section>
    );
  }

  const busy = working || state.busy || state.bulkProgress.running;
  const retentionReduced =
    settings.fullRetention < state.settings.fullRetention ||
    (settings.differentialRetention ?? 0) <
      (state.settings.differentialRetention ?? 0);
  const canSaveAdvanced =
    (!retentionReduced || retentionAcknowledged) &&
    (!pathsDirty || pathsAcknowledged);
  const sortedGames = [...state.games].sort((a, b) =>
    a.title.localeCompare(b.title)
  );
  const gameAutoBackupEnabled = advancedGameSettings.enabled !== false;
  const requestDisable = (
    target: "global" | { gameKey: string; title: string }
  ) => {
    setDisableAcknowledged(false);
    setPendingDisable(target);
  };

  const stageGameEnabled = (key: string, enabled: boolean) => {
    setSettings({
      ...settings,
      games: {
        ...settings.games,
        [key]: { ...(settings.games[key] ?? emptyGameSettings), enabled },
      },
    });
    setNotice("Unsaved change. Use Save backup settings to apply it.");
  };
  const confirmDisable = () => {
    if (!pendingDisable || !disableAcknowledged) return;
    if (pendingDisable === "global") update({ enabled: false });
    else stageGameEnabled(pendingDisable.gameKey, false);
    setPendingDisable(null);
    setNotice("Unsaved change. Use Save backup settings to apply it.");
  };
  const saveSelectedGameEnabled = (enabled: boolean) =>
    stageGameEnabled(advancedGameKey, enabled);
  const saveGlobalEnabled = (enabled: boolean) => update({ enabled });
  const saveAdvancedChanges = async () => {
    if (retentionReduced && !retentionAcknowledged)
      throw new Error(t("retention_ack_required"));
    if (pathsDirty && !pathsAcknowledged)
      throw new Error(t("paths_ack_required"));
    const current = await window.electron.getLudusaviLocalState();
    if (!settingsValueEqual(current.settings, savedSettings))
      throw new Error(
        "Backup settings changed elsewhere. Discard edits and review the current settings before trying again."
      );
    const next = { ...settings, games: { ...settings.games } };
    if (pathsDirty && advancedGameKey)
      next.games[advancedGameKey] = {
        ...(next.games[advancedGameKey] ?? emptyGameSettings),
        savePaths: savePathsText
          .split("\n")
          .map((line) => line.trim())
          .filter(Boolean),
        trackingPaths: trackingPathsText
          .split("\n")
          .map((line) => line.trim())
          .filter(Boolean),
      };
    const review = [
      "Save backup settings. These control future automatic backups and recovery operations.",
    ];
    if (next.enabled !== state.settings.enabled)
      review.push(
        next.enabled
          ? "Enable automatic backups."
          : "Disable ALL automatic backups. Future game sessions will not be protected automatically."
      );
    if (next.destination !== state.settings.destination)
      review.push(
        "Change backup destination. Existing backups will not be moved. Versions in the previous location will no longer be listed here."
      );
    if (retentionReduced)
      review.push(
        "Reduce retained versions. Older backup versions may be deleted during future backups."
      );
    if (pathsDirty)
      review.push(
        "Change custom save or process paths. This changes which files are protected and how game exit is detected."
      );
    if (!settingsValueEqual(next.games, state.settings.games))
      review.push(
        "Change per-game backup rules, save matching, or automatic backup participation."
      );
    if (!(await confirm("save", review)))
      throw new Error("Changes were not saved.");
    const latest = await window.electron.saveLudusaviLocalSettings(next);
    setSettings(latest.settings);
    setSavedSettings(latest.settings);
    setPathsAcknowledged(false);
    setRetentionAcknowledged(false);
    setNotice("Backup settings saved.");
  };
  const requireSavedSettings = async () => {
    if (settingsDirty || pathsDirty)
      throw new Error(
        "Save or discard your backup settings edits before opening the save manager."
      );
  };

  return (
    <section className="local-edition local-edition--backups">
      {error && (
        <p role="alert" className="local-edition__error">
          {error}
        </p>
      )}
      <header className="local-edition__card">
        <div className="local-edition__card-header">
          <div>
            <h3 className="local-edition__card-title">
              {t("advanced_view_title")}
            </h3>
            <p className="local-edition__card-subtitle">
              {t("advanced_view_description")}
            </p>
          </div>
          <Button
            disabled={
              busy || !canSaveAdvanced || (!settingsDirty && !pathsDirty)
            }
            onClick={() => action(saveAdvancedChanges, true)}
          >
            Save backup settings
          </Button>
        </div>
        <p className="local-edition__notice">{t("backup_only_notice")}</p>
      </header>

      <details className="local-edition__advanced-menu">
        <summary>
          <span>{t("automatic_backup_controls_title")}</span>
          <small>{t("automatic_backup_controls_description")}</small>
        </summary>
        <div className="local-edition__advanced-menu-body">
          <div className="local-edition__subcard">
            <div className="local-edition__card-header">
              <div>
                <h4 className="local-edition__section-heading">
                  {t("automatic_backup_controls_title")}
                </h4>
                <p className="local-edition__hint">
                  {t("automatic_backup_controls_description")}
                </p>
              </div>
            </div>
            <CheckboxField
              label={t("enable")}
              checked={settings.enabled}
              disabled={busy || Boolean(pendingDisable)}
              onChange={(event) => {
                if (!event.target.checked) requestDisable("global");
                else void saveGlobalEnabled(true);
              }}
            />
            {!settings.enabled && (
              <p className="local-edition__safety-warning" role="status">
                {t("automatic_backups_disabled_notice")}
              </p>
            )}
            {pendingDisable === "global" && (
              <div className="local-edition__safety-warning" role="alert">
                <p>{t("confirm_disable_global_description")}</p>
                <CheckboxField
                  label={t("confirm_disable_global_acknowledgement")}
                  checked={disableAcknowledged}
                  onChange={(event) =>
                    setDisableAcknowledged(event.target.checked)
                  }
                />
                <div className="local-edition__actions">
                  <Button
                    disabled={busy || !disableAcknowledged}
                    onClick={() => void confirmDisable()}
                  >
                    {t("confirm_disable_backups")}
                  </Button>
                  <Button
                    theme="outline"
                    disabled={busy}
                    onClick={() => setPendingDisable(null)}
                  >
                    {t("cancel_clear")}
                  </Button>
                </div>
              </div>
            )}
          </div>
        </div>
      </details>

      <details className="local-edition__advanced-menu">
        <summary>
          <span>{t("destination")}</span>
          <small>{t("destination_warning")}</small>
        </summary>
        <div className="local-edition__advanced-menu-body">
          <div className="local-edition__subcard">
            <div className="local-edition__card-header">
              <div>
                <h4 className="local-edition__section-heading">
                  {t("destination")}
                </h4>
                <p className="local-edition__hint">
                  {t("destination_warning")}
                </p>
              </div>
            </div>
            <p className="local-edition__hint">{t("save_advanced_hint")}</p>
            <TextField
              label={t("destination")}
              value={settings.destination}
              disabled={busy}
              onChange={(event) =>
                setSettings({ ...settings, destination: event.target.value })
              }
              rightContent={
                <Button
                  theme="outline"
                  disabled={busy}
                  onClick={async () => {
                    try {
                      const result = await window.electron.showOpenDialog({
                        properties: ["openDirectory", "createDirectory"],
                        defaultPath: settings.destination,
                      });
                      if (result.filePaths[0]) {
                        setSettings({
                          ...settings,
                          destination: result.filePaths[0],
                        });
                      }
                    } catch (e) {
                      setError(String(e));
                    }
                  }}
                >
                  {t("browse")}
                </Button>
              }
            />
          </div>
        </div>
      </details>

      <details className="local-edition__advanced-menu">
        <summary>
          <span>{t("retention_section_title")}</span>
          <small>{t("retention_warning")}</small>
        </summary>
        <div className="local-edition__advanced-menu-body">
          <div className="local-edition__subcard">
            <div className="local-edition__card-header">
              <h4 className="local-edition__section-heading">
                {t("retention_section_title")}
              </h4>
            </div>
            <div className="local-edition__grid-3">
              <TextField
                label={t("retention")}
                type="number"
                min={1}
                max={255}
                value={String(settings.fullRetention)}
                onChange={(e) => {
                  setRetentionAcknowledged(false);
                  update({ fullRetention: Number(e.target.value) });
                }}
              />
              <TextField
                label={t("differential_retention")}
                type="number"
                min={0}
                max={255}
                value={String(settings.differentialRetention ?? 0)}
                onChange={(e) => {
                  setRetentionAcknowledged(false);
                  update({ differentialRetention: Number(e.target.value) });
                }}
              />
              <TextField
                label={t("exit_delay")}
                type="number"
                min={5}
                max={300}
                value={String(settings.exitDelaySeconds)}
                onChange={(e) =>
                  update({ exitDelaySeconds: Number(e.target.value) })
                }
              />
            </div>
            <p className="local-edition__safety-warning">
              {t("retention_warning")}
            </p>
            {retentionReduced && (
              <CheckboxField
                label={t("retention_acknowledgement")}
                checked={retentionAcknowledged}
                onChange={(event) =>
                  setRetentionAcknowledged(event.target.checked)
                }
              />
            )}
            <div className="local-edition__grid-2">
              <label className="local-edition__label">
                {t("backup_format")}
                <select
                  value={settings.format ?? "zip"}
                  onChange={(e) =>
                    update({ format: e.target.value as "zip" | "simple" })
                  }
                >
                  <option value="zip">ZIP</option>
                  <option value="simple">{t("simple_format")}</option>
                </select>
              </label>
              <label className="local-edition__label">
                {t("compression")}
                <select
                  disabled={settings.format === "simple"}
                  value={settings.compression ?? "deflate"}
                  onChange={(e) =>
                    update({
                      compression: e.target.value as NonNullable<
                        LudusaviLocalSettings["compression"]
                      >,
                    })
                  }
                >
                  {["none", "deflate", "bzip2", "zstd"].map((method) => (
                    <option key={method} value={method}>
                      {method}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          </div>
        </div>
      </details>

      <details className="local-edition__advanced-menu">
        <summary>
          <span>
            {t("custom_paths_section_title", {
              game: advancedGame?.title ?? t("game"),
            })}
          </span>
          <small>{t("custom_paths_menu_description")}</small>
        </summary>
        <div className="local-edition__advanced-menu-body">
          <div className="local-edition__subcard">
            <div className="local-edition__card-header">
              <div>
                <h4 className="local-edition__section-heading">
                  {t("custom_paths_section_title", {
                    game: advancedGame?.title ?? t("game"),
                  })}
                </h4>
                <p className="local-edition__hint">
                  {t("independent_game_selection")}
                </p>
              </div>
            </div>
            <label className="local-edition__label">
              {t("advanced_game_selection")}
              <select
                value={advancedGameKey}
                disabled={
                  busy ||
                  Boolean(pendingDisable) ||
                  pendingUnlink ||
                  !sortedGames.length
                }
                onChange={(event) => {
                  const nextKey = event.target.value;
                  setAdvancedGameKey(nextKey);
                  setPathsAcknowledged(false);
                  setPendingUnlink(false);
                  setUnlinkAcknowledged(false);
                  const nextSettings = settings.games[nextKey];
                  setSavePathsText(nextSettings?.savePaths.join("\n") ?? "");
                  setTrackingPathsText(
                    nextSettings?.trackingPaths.join("\n") ?? ""
                  );
                }}
              >
                {sortedGames.map((game) => (
                  <option value={game.key} key={game.key}>
                    {game.title}
                  </option>
                ))}
              </select>
            </label>
            {advancedGame && (
              <>
                <CheckboxField
                  label={t("enable_game")}
                  checked={gameAutoBackupEnabled}
                  disabled={busy || Boolean(pendingDisable)}
                  onChange={(event) => {
                    if (!event.target.checked) {
                      requestDisable({
                        gameKey: advancedGameKey,
                        title: advancedGame.title,
                      });
                    } else {
                      void saveSelectedGameEnabled(true);
                    }
                  }}
                />
                {!gameAutoBackupEnabled && (
                  <p className="local-edition__safety-warning" role="status">
                    {t("game_automatic_backup_disabled_notice", {
                      game: advancedGame.title,
                    })}
                  </p>
                )}
                {pendingDisable && pendingDisable !== "global" && (
                  <div className="local-edition__safety-warning" role="alert">
                    <p>
                      {t("confirm_disable_game_description", {
                        game: pendingDisable.title,
                      })}
                    </p>
                    <CheckboxField
                      label={t("confirm_disable_game_acknowledgement", {
                        game: pendingDisable.title,
                      })}
                      checked={disableAcknowledged}
                      onChange={(event) =>
                        setDisableAcknowledged(event.target.checked)
                      }
                    />
                    <div className="local-edition__actions">
                      <Button
                        disabled={busy || !disableAcknowledged}
                        onClick={() => void confirmDisable()}
                      >
                        {t("confirm_disable_backups")}
                      </Button>
                      <Button
                        theme="outline"
                        disabled={busy}
                        onClick={() => setPendingDisable(null)}
                      >
                        {t("cancel_clear")}
                      </Button>
                    </div>
                  </div>
                )}
                {advancedGameSettings.manifestTitle && (
                  <div className="local-edition__row">
                    <span className="local-edition__hint">
                      {t("linked_save_title", {
                        title: advancedGameSettings.manifestTitle,
                      })}
                    </span>
                    <Button
                      theme="outline"
                      disabled={busy}
                      onClick={() => {
                        setUnlinkAcknowledged(false);
                        setPendingUnlink(true);
                      }}
                    >
                      {t("unlink_save_title")}
                    </Button>
                  </div>
                )}
                {pendingUnlink && (
                  <div className="local-edition__safety-warning" role="alert">
                    <p>{t("unlink_save_warning")}</p>
                    <CheckboxField
                      label={t("unlink_save_acknowledgement")}
                      checked={unlinkAcknowledged}
                      onChange={(event) =>
                        setUnlinkAcknowledged(event.target.checked)
                      }
                    />
                    <div className="local-edition__actions">
                      <Button
                        disabled={busy || !unlinkAcknowledged}
                        onClick={() => {
                          setPendingUnlink(false);
                          setUnlinkAcknowledged(false);
                          const nextGame = { ...advancedGameSettings };
                          delete nextGame.manifestTitle;
                          delete nextGame.steamId;
                          setSettings({
                            ...settings,
                            games: {
                              ...settings.games,
                              [advancedGameKey]: nextGame,
                            },
                          });
                          setNotice(
                            "Save matching will change only after Save backup settings."
                          );
                        }}
                      >
                        {t("unlink_save_title")}
                      </Button>
                      <Button
                        theme="outline"
                        disabled={busy}
                        onClick={() => {
                          setPendingUnlink(false);
                          setUnlinkAcknowledged(false);
                        }}
                      >
                        {t("cancel_clear")}
                      </Button>
                    </div>
                  </div>
                )}
                <label className="local-edition__label">
                  {t("save_paths")}
                  <textarea
                    rows={3}
                    value={savePathsText}
                    disabled={busy}
                    onChange={(event) => {
                      setSavePathsText(event.target.value);
                      setPathsAcknowledged(false);
                    }}
                  />
                </label>
                <label className="local-edition__label">
                  {t("tracking_paths")}
                  <textarea
                    rows={2}
                    value={trackingPathsText}
                    disabled={busy}
                    onChange={(event) => {
                      setTrackingPathsText(event.target.value);
                      setPathsAcknowledged(false);
                    }}
                  />
                </label>
                <p className="local-edition__safety-warning">
                  {t("custom_paths_safety_warning")}
                </p>
                <CheckboxField
                  label={t("custom_paths_acknowledgement")}
                  checked={pathsAcknowledged}
                  disabled={busy || !pathsDirty}
                  onChange={(event) =>
                    setPathsAcknowledged(event.target.checked)
                  }
                />
                {notice && (
                  <p role="status" className="local-edition__status-banner">
                    {notice}
                  </p>
                )}
                <div className="local-edition__row">
                  <Button
                    disabled={busy || !pathsDirty || !pathsAcknowledged}
                    onClick={() => action(saveAdvancedChanges, true)}
                  >
                    {t("save_custom_paths")}
                  </Button>
                </div>
              </>
            )}
            {!advancedGame && (
              <p className="local-edition__hint">{t("no_games")}</p>
            )}
          </div>
        </div>
      </details>

      <details className="local-edition__advanced-menu">
        <summary>
          <span>{t("versions_title")}</span>
          <small>{t("restore_safety_warning")}</small>
        </summary>
        <div className="local-edition__advanced-menu-body">
          <div className="local-edition__subcard">
            <div className="local-edition__card-header">
              <div>
                <h4 className="local-edition__section-heading">
                  {t("versions_title")}
                </h4>
                <p className="local-edition__safety-warning">
                  {t("restore_safety_warning")}
                </p>
              </div>
            </div>
            <SettingsSaveManager
              mode="versions"
              gameKey={advancedGameKey}
              destination={settings.destination}
              busy={busy || !canSaveAdvanced}
              beforeAction={requireSavedSettings}
              refresh={refresh}
              reloadSettings={async () => {
                const latest = await refresh();
                setSettings(latest.settings);
                setSavedSettings(latest.settings);
              }}
            />
          </div>
        </div>
      </details>

      <details className="local-edition__advanced-menu">
        <summary>
          <span>{t("full_manager_menu_title")}</span>
          <small>{t("full_manager_menu_description")}</small>
        </summary>
        <div className="local-edition__advanced-menu-body">
          <SettingsSaveManager
            mode="advanced"
            gameKey={advancedGameKey}
            destination={settings.destination}
            busy={busy || !canSaveAdvanced}
            beforeAction={requireSavedSettings}
            refresh={refresh}
            reloadSettings={async () => {
              const latest = await refresh();
              setSettings(latest.settings);
              setSavedSettings(latest.settings);
            }}
          />
        </div>
      </details>

      <details className="local-edition__advanced-menu">
        <summary>
          <span>{t("history")}</span>
          <small>{t("log_limits")}</small>
        </summary>
        <div className="local-edition__advanced-menu-body">
          <div className="local-edition__subcard">
            <div className="local-edition__card-header">
              <div>
                <h4 className="local-edition__section-heading">
                  {t("history")}
                </h4>
                <p className="local-edition__hint">{t("log_limits")}</p>
              </div>
              <div className="local-edition__actions">
                <Button
                  theme="outline"
                  onClick={() =>
                    action(() => window.electron.openLudusaviLocalFolder(true))
                  }
                >
                  {t("open_logs")}
                </Button>
                <Button
                  theme="outline"
                  disabled={busy || confirmClear}
                  onClick={() => {
                    setClearNotice("");
                    setConfirmClear(true);
                  }}
                >
                  {t("clear_logs")}
                </Button>
              </div>
            </div>

            {confirmClear && (
              <div className="local-edition__notice">
                <p>{t("clear_logs_confirmation")}</p>
                <div className="local-edition__row">
                  <Button
                    disabled={busy}
                    onClick={() =>
                      action(async () => {
                        await window.electron.clearLudusaviLocalLogs();
                        setConfirmClear(false);
                        setClearNotice(t("logs_cleared"));
                      })
                    }
                  >
                    {t("clear_logs")}
                  </Button>
                  <Button
                    theme="outline"
                    disabled={working}
                    onClick={() => setConfirmClear(false)}
                  >
                    {t("cancel_clear")}
                  </Button>
                </div>
              </div>
            )}
            {clearNotice && (
              <p role="status" className="local-edition__status-banner">
                {clearNotice}
              </p>
            )}
            <p className="local-edition__hint">{t("cloud_notice")}</p>
            {!state.history.length && (
              <p className="local-edition__hint">{t("no_history")}</p>
            )}
            {state.history.slice(0, 12).map((result, index) => (
              <details
                key={`${result.at}-${index}`}
                className={`local-edition__result local-edition__result--${result.status}`}
              >
                <summary>
                  {new Date(result.at).toLocaleString()} · {result.title} ·{" "}
                  {t(`operation_${result.operation ?? "backup"}`)} ·{" "}
                  {result.status === "success" &&
                  result.operation &&
                  result.operation !== "backup"
                    ? t("operation_complete")
                    : t(`status_${result.status}`)}
                </summary>
                <p>{result.message}</p>
                <p>
                  {t("contents", {
                    files: result.files,
                    bytes: result.bytes,
                    registry: result.registryKeys,
                  })}
                </p>
                {!result.files && result.registryKeys > 0 && (
                  <p className="local-edition__error">{t("registry_only")}</p>
                )}
                <pre>{result.filePaths.join("\n")}</pre>
              </details>
            ))}
          </div>
        </div>
      </details>

      <details className="local-edition__advanced-menu">
        <summary>
          <span>{t("engine_information")}</span>
          <small>{t("engine_information_menu_description")}</small>
        </summary>
        <div className="local-edition__advanced-menu-body">
          <details className="local-edition__subdrawer">
            <summary>{t("engine_information")}</summary>
            <div className="local-edition__engine-information">
              <p>{t("engine_credit", { version: saveEngine.version })}</p>
              <p>{t("engine_update_policy")}</p>
            </div>
          </details>
        </div>
      </details>
    </section>
  );
}
