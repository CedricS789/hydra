import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button, CheckboxField, TextField } from "@renderer/components";
import type { LudusaviLocalSettings, LudusaviLocalState } from "@types";
import "./settings-local-edition.scss";

export function SettingsLudusavi() {
  const { t } = useTranslation("ludusavi");
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
        setSelected(value.games[0]?.key ?? "");
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
      <h2>{t("title")}</h2>
      <p>{t("description")}</p>
      <p className="local-edition__notice">{t("backup_only_notice")}</p>
      {error && (
        <p role="alert" className="local-edition__error">
          {error}
        </p>
      )}
      <CheckboxField
        label={t("enable")}
        checked={settings.enabled}
        onChange={(e) => update({ enabled: e.target.checked })}
      />
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
      <div className="local-edition__row">
        <TextField
          label={t("retention")}
          type="number"
          min={1}
          max={255}
          value={String(settings.fullRetention)}
          onChange={(e) => update({ fullRetention: Number(e.target.value) })}
        />
        <TextField
          label={t("exit_delay")}
          type="number"
          min={5}
          max={300}
          value={String(settings.exitDelaySeconds)}
          onChange={(e) => update({ exitDelaySeconds: Number(e.target.value) })}
        />
        <Button disabled={working} onClick={() => action(save)}>
          {t("save")}
        </Button>
      </div>
      <div className="local-edition__row">
        <Button
          theme="outline"
          onClick={() =>
            action(() => window.electron.openLudusaviLocalFolder())
          }
        >
          {t("open_destination")}
        </Button>
        <Button
          theme="outline"
          onClick={() =>
            action(() => window.electron.openLudusaviLocalFolder(true))
          }
        >
          {t("open_logs")}
        </Button>
      </div>
      <h3>{t("games")}</h3>
      <p>{t("games_description")}</p>
      {!state.games.length ? (
        <p>{t("no_games")}</p>
      ) : (
        <>
          <label className="local-edition__label">
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
          <code>
            {state.games.find((g) => g.key === selected)?.executablePath ||
              t("missing_executable")}
          </code>
          <CheckboxField
            label={t("enable_game")}
            checked={game.enabled}
            onChange={(e) => updateGame({ enabled: e.target.checked })}
          />
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
          <div className="local-edition__row">
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
        </>
      )}
      <h3>{t("history")}</h3>
      <p>{t("log_limits")}</p>
      <div className="local-edition__row">
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
      {clearNotice && <p role="status">{clearNotice}</p>}
      <p>{t("cloud_notice")}</p>
      {!state.history.length && <p>{t("no_history")}</p>}
      {state.history.slice(0, 12).map((result, index) => (
        <details
          key={`${result.at}-${index}`}
          className={`local-edition__result local-edition__result--${result.status}`}
        >
          <summary>
            {new Date(result.at).toLocaleString()} · {result.title} ·{" "}
            {t(`status_${result.status}`)}
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
  );
}
