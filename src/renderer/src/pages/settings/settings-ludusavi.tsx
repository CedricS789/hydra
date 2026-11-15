import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button, CheckboxField, TextField } from "@renderer/components";
import type { LudusaviLocalSettings, LudusaviLocalState } from "@types";
import "./settings-local-edition.scss";
import { SettingsSaveManager } from "./settings-save-manager";
import { SettingsSaveDiscovery } from "./settings-save-discovery";
import { useLibrary } from "@renderer/hooks/use-library";
import saveEngine from "../../../../shared/save-engine.json";

export function SettingsLudusavi() {
  const { t } = useTranslation("ludusavi");
  const { updateLibrary } = useLibrary();
  const [state, setState] = useState<LudusaviLocalState>();
  const [settings, setSettings] = useState<LudusaviLocalSettings>();
  const [selected, setSelected] = useState("");
  const [working, setWorking] = useState(false);
  const [error, setError] = useState("");
  const [confirmClear, setConfirmClear] = useState(false);
  const [clearNotice, setClearNotice] = useState("");

  const refresh = async () => {
    const value = await window.electron.getLudusaviLocalState();
    setState(value);
    return value;
  };

  useEffect(() => {
    let mounted = true;
    window.electron
      .getLudusaviLocalState()
      .then((value) => {
        if (!mounted) return;
        setState(value);
        setSettings(value.settings);
        const query = new URLSearchParams(
          globalThis.location.hash.split("?")[1] ?? globalThis.location.search
        );
        const requested = query.get("game");
        setSelected(
          value.games.find((game) => game.key === requested)?.key ??
            value.games[0]?.key ??
            ""
        );
      })
      .catch((e) => mounted && setError(String(e)));
    const timer = setInterval(() => {
      window.electron
        .getLudusaviLocalState()
        .then((value) => mounted && setState(value))
        .catch((e) => mounted && setError(String(e)));
    }, 3000);
    return () => {
      mounted = false;
      clearInterval(timer);
    };
  }, []);

  const action = async (task: () => Promise<unknown>) => {
    setWorking(true);
    setError("");
    try {
      await task();
      await refresh();
    } catch (e) {
      setError(String(e));
    } finally {
      setWorking(false);
    }
  };

  if (!settings || !state) return <p role="status">{error || t("loading")}</p>;

  const update = (value: Partial<LudusaviLocalSettings>) =>
    setSettings({ ...settings, ...value });
  const game = settings.games[selected] ?? {
    enabled: true,
    savePaths: [],
    trackingPaths: [],
  };
  const selectedGameInfo = state.games.find((g) => g.key === selected);
  const updateGame = (value: Partial<typeof game>) =>
    update({ games: { ...settings.games, [selected]: { ...game, ...value } } });
  const save = () => window.electron.saveLudusaviLocalSettings(settings);
  const preview = (isPreview: boolean) =>
    action(async () => {
      await save();
      await window.electron.runLudusaviLocalBackup(selected, isPreview);
    });

  return (
    <div className="settings-context-panel local-edition">
      {error && (
        <p role="alert" className="local-edition__error">
          {error}
        </p>
      )}
      {state.history[0] && (
        <p
          role={state.history[0].status === "failed" ? "alert" : "status"}
          className={
            state.history[0].status === "failed"
              ? "local-edition__error"
              : "local-edition__status-banner"
          }
        >
          {state.history[0].title} ·{" "}
          {t(`operation_${state.history[0].operation ?? "backup"}`)} ·{" "}
          {state.history[0].status === "success" &&
          state.history[0].operation &&
          state.history[0].operation !== "backup"
            ? t("operation_complete")
            : t(`status_${state.history[0].status}`)}
          {": "}
          {state.history[0].message}
        </p>
      )}

      {/* 1. Primary Automatic Save Backups Card */}
      <section className="local-edition__card">
        <div className="local-edition__card-header">
          <div>
            <div className="local-edition__title-with-badge">
              <h3 className="local-edition__card-title">
                {t("auto_backups_title")}
              </h3>
              <span
                className={`local-edition__badge ${
                  settings.enabled
                    ? "local-edition__badge--library"
                    : "local-edition__badge--unmatched"
                }`}
              >
                {settings.enabled ? t("status_enabled") : t("status_disabled")}
              </span>
            </div>
            <p className="local-edition__card-subtitle">{t("description")}</p>
          </div>
          <div className="local-edition__actions">
            <Button
              theme="outline"
              onClick={() =>
                action(() => window.electron.openLudusaviLocalFolder())
              }
            >
              {t("open_destination")}
            </Button>
            <Button disabled={working} onClick={() => action(save)}>
              {t("save")}
            </Button>
          </div>
        </div>

        <CheckboxField
          label={t("enable")}
          checked={settings.enabled}
          onChange={(e) => update({ enabled: e.target.checked })}
        />
        <p className="local-edition__hint">{t("cloud_notice")}</p>

        <TextField
          label={t("destination")}
          value={settings.destination}
          onChange={(e) => update({ destination: e.target.value })}
          rightContent={
            <Button
              theme="outline"
              onClick={() =>
                action(async () => {
                  const result = await window.electron.showOpenDialog({
                    properties: ["openDirectory", "createDirectory"],
                    defaultPath: settings.destination,
                  });
                  if (result.filePaths[0])
                    update({ destination: result.filePaths[0] });
                })
              }
            >
              {t("browse")}
            </Button>
          }
        />
      </section>

      {/* 2. Discover Saved Games Card */}
      <SettingsSaveDiscovery
        games={state.games}
        busy={working || state.busy}
        destination={settings.destination}
        beforeAction={save}
        refresh={refresh}
        onAdded={async (key) => {
          const latest = await refresh();
          setSettings(latest.settings);
          setSelected(key);
          await updateLibrary();
        }}
      />

      {/* 3. Game Backup & Restore Card */}
      <section className="local-edition__card">
        <div className="local-edition__card-header">
          <div>
            <h3 className="local-edition__card-title">{t("games")}</h3>
            <p className="local-edition__card-subtitle">
              {t("games_description")}
            </p>
          </div>
          {!!state.games.length && (
            <div className="local-edition__actions">
              <Button
                theme="outline"
                disabled={working || state.busy}
                onClick={() => preview(true)}
              >
                {t("preview")}
              </Button>
              <Button
                disabled={working || state.busy}
                onClick={() => preview(false)}
              >
                {t("backup_now")}
              </Button>
            </div>
          )}
        </div>

        {!state.games.length ? (
          <p className="local-edition__hint">{t("no_games")}</p>
        ) : (
          <>
            <div className="local-edition__game-bar">
              <label className="local-edition__label local-edition__game-select">
                {t("game")}
                <select
                  value={selected}
                  onChange={(e) => setSelected(e.target.value)}
                >
                  {state.games.map((g) => (
                    <option key={g.key} value={g.key}>
                      {g.title}
                    </option>
                  ))}
                </select>
              </label>
              <div className="local-edition__game-status">
                <CheckboxField
                  label={t("enable_game")}
                  checked={game.enabled}
                  onChange={(e) => updateGame({ enabled: e.target.checked })}
                />
                {selectedGameInfo?.executablePath ? (
                  <code className="local-edition__exe-pill">
                    {selectedGameInfo.executablePath}
                  </code>
                ) : (
                  <span className="local-edition__badge local-edition__badge--unmatched">
                    {t("not_installed_badge")}
                  </span>
                )}
              </div>
            </div>

            <SettingsSaveManager
              mode="versions"
              gameKey={selected}
              destination={settings.destination}
              busy={working || state.busy}
              beforeAction={save}
              refresh={refresh}
              reloadSettings={async () => {
                const latest = await refresh();
                setSettings(latest.settings);
              }}
            />
          </>
        )}
      </section>

      {/* 4. Hidden-by-default Advanced Settings Drawer at the Bottom */}
      <details className="local-edition__advanced">
        <summary className="local-edition__advanced-summary">
          <div>
            <span className="local-edition__advanced-title">
              {t("advanced_drawer_title")}
            </span>
            <span className="local-edition__advanced-subtitle">
              {t("advanced_drawer_subtitle")}
            </span>
          </div>
        </summary>

        <div className="local-edition__advanced-body">
          <p className="local-edition__notice">
            {t("engine_credit", { version: saveEngine.version })}{" "}
            {t("backup_only_notice")} {t("engine_update_policy")}
          </p>

          {/* Retention & Archive Format */}
          <div className="local-edition__subcard">
            <div className="local-edition__card-header">
              <h4 className="local-edition__section-heading">
                {t("retention_section_title")}
              </h4>
              <Button disabled={working} onClick={() => action(save)}>
                {t("save")}
              </Button>
            </div>
            <div className="local-edition__grid-3">
              <TextField
                label={t("retention")}
                type="number"
                min={1}
                max={255}
                value={String(settings.fullRetention)}
                onChange={(e) =>
                  update({ fullRetention: Number(e.target.value) })
                }
              />
              <TextField
                label={t("differential_retention")}
                type="number"
                min={0}
                max={255}
                value={String(settings.differentialRetention ?? 0)}
                onChange={(e) =>
                  update({ differentialRetention: Number(e.target.value) })
                }
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

          {/* Per-game Custom Save Paths & Process Tracking */}
          {!!state.games.length && selectedGameInfo && (
            <div className="local-edition__subcard">
              <div className="local-edition__card-header">
                <h4 className="local-edition__section-heading">
                  {t("custom_paths_section_title", {
                    game: selectedGameInfo.title,
                  })}
                </h4>
                <Button disabled={working} onClick={() => action(save)}>
                  {t("save")}
                </Button>
              </div>
              {game.manifestTitle && (
                <div className="local-edition__row">
                  <span className="local-edition__hint">
                    {t("linked_save_title", { title: game.manifestTitle })}
                  </span>
                  <Button
                    theme="outline"
                    disabled={working || state.busy}
                    onClick={() =>
                      updateGame({
                        manifestTitle: undefined,
                        steamId: undefined,
                      })
                    }
                  >
                    {t("unlink_save_title")}
                  </Button>
                </div>
              )}
              <label className="local-edition__label">
                {t("save_paths")}
                <textarea
                  rows={3}
                  value={game.savePaths.join("\n")}
                  onChange={(e) =>
                    updateGame({
                      savePaths: e.target.value.split("\n").filter(Boolean),
                    })
                  }
                />
              </label>
              <label className="local-edition__label">
                {t("tracking_paths")}
                <textarea
                  rows={2}
                  value={game.trackingPaths.join("\n")}
                  onChange={(e) =>
                    updateGame({
                      trackingPaths: e.target.value.split("\n").filter(Boolean),
                    })
                  }
                />
              </label>
            </div>
          )}

          {/* Advanced Rules, Full Ludusavi Manager & Rclone Remote Storage */}
          <SettingsSaveManager
            mode="advanced"
            gameKey={selected}
            destination={settings.destination}
            busy={working || state.busy}
            beforeAction={save}
            refresh={refresh}
            reloadSettings={async () => {
              const latest = await refresh();
              setSettings(latest.settings);
            }}
          />

          {/* Recent Backup Results & Logs */}
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
                  disabled={working || state.busy || confirmClear}
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
                    disabled={working || state.busy}
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
    </div>
  );
}
