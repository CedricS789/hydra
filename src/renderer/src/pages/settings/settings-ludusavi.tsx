import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { Button, CheckboxField, TextField } from "@renderer/components";
import type { GameShop, LudusaviLocalSettings } from "@types";
import "./settings-local-edition.scss";
import { SettingsSaveManager } from "./settings-save-manager";
import { SettingsSaveDiscovery } from "./settings-save-discovery";
import { useDate, useLibrary, useLudusaviLocalState } from "@renderer/hooks";
import { useGameOptionsModal } from "@renderer/context/game-options-modal/game-options-modal.context";
import { buildGameDetailsPath } from "@renderer/helpers";
import saveEngine from "../../../../shared/save-engine.json";

const parseGameKey = (
  key: string
): { shop: GameShop; objectId: string } | null => {
  const idx = key.indexOf(":");
  if (idx <= 0) return null;
  return {
    shop: key.slice(0, idx) as GameShop,
    objectId: key.slice(idx + 1),
  };
};

export function SettingsLudusavi() {
  const { t } = useTranslation("ludusavi");
  const { formatDateTime, formatDistance } = useDate();
  const navigate = useNavigate();
  const { library, updateLibrary } = useLibrary();
  const { openGameOptionsModal } = useGameOptionsModal();
  const { state, error: stateError, refresh } = useLudusaviLocalState();

  const [settings, setSettings] = useState<LudusaviLocalSettings>();
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [includeDisabledBulk, setIncludeDisabledBulk] = useState(false);
  const [overviewFilter, setOverviewFilter] = useState("");
  const mainHeading = useRef<HTMLHeadingElement>(null);
  const advancedHeading = useRef<HTMLHeadingElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState("");
  const [confirmClear, setConfirmClear] = useState(false);
  const [clearNotice, setClearNotice] = useState("");

  useEffect(() => {
    (advancedOpen ? advancedHeading : mainHeading).current?.focus({
      preventScroll: true,
    });
    panel.current?.closest(".settings__panel")?.scrollTo({ top: 0 });
  }, [advancedOpen]);

  useEffect(() => {
    if (state && !settings) {
      setSettings(state.settings);
    }
  }, [state, settings]);

  useEffect(() => {
    if (stateError) setError(stateError);
  }, [stateError]);

  const libraryByKey = useMemo(() => {
    const map = new Map<string, (typeof library)[number]>();
    for (const item of library) {
      map.set(`${item.shop}:${item.objectId}`, item);
    }
    return map;
  }, [library]);

  const filteredGames = useMemo(() => {
    if (!state) return [];
    const term = overviewFilter.trim().toLowerCase();
    const sorted = [...state.games].sort((a, b) =>
      a.title.localeCompare(b.title)
    );
    if (!term) return sorted;
    return sorted.filter((game) => game.title.toLowerCase().includes(term));
  }, [state, overviewFilter]);

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
  const save = async () => {
    const latest = await window.electron.saveLudusaviLocalSettings(settings);
    setSettings(latest.settings);
    return latest;
  };

  const openGameBackups = (game: { key: string; title: string }) => {
    const libraryGame = libraryByKey.get(game.key);
    if (libraryGame) {
      openGameOptionsModal(libraryGame, "local_backups");
      return;
    }
    const parsed = parseGameKey(game.key);
    if (parsed) {
      navigate(
        buildGameDetailsPath({
          shop: parsed.shop,
          objectId: parsed.objectId,
          title: game.title,
        })
      );
    }
  };

  const busy = working || state.busy || state.bulkProgress.running;
  const bulk = state.bulkProgress;
  const lastBulkSummary = bulk.lastSummary;
  const bulkIssueCount = lastBulkSummary
    ? lastBulkSummary.skippedGames.length + lastBulkSummary.failures.length
    : 0;

  return (
    <div
      ref={panel}
      className="settings-context-panel local-edition local-edition--backups"
    >
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

      <div className="local-edition__main-view" hidden={advancedOpen}>
        <section className="local-edition__card">
          <div className="local-edition__card-header">
            <div>
              <div className="local-edition__title-with-badge">
                <h3
                  ref={mainHeading}
                  tabIndex={-1}
                  className="local-edition__card-title"
                >
                  {t("auto_backups_title")}
                </h3>
                <span
                  className={`local-edition__badge ${
                    settings.enabled
                      ? "local-edition__badge--library"
                      : "local-edition__badge--unmatched"
                  }`}
                >
                  {settings.enabled
                    ? t("status_enabled")
                    : t("status_disabled")}
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
              <Button disabled={busy} onClick={() => action(save)}>
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

        <section className="local-edition__card">
          <div className="local-edition__card-header">
            <div>
              <h3 className="local-edition__card-title">{t("bulk_title")}</h3>
              <p className="local-edition__card-subtitle">
                {t("bulk_description")}
              </p>
            </div>
            <div className="local-edition__actions">
              <Button
                disabled={busy || !state.games.length}
                onClick={() =>
                  action(async () => {
                    await save();
                    await window.electron.runLudusaviLocalBulkBackup(
                      includeDisabledBulk
                    );
                  })
                }
              >
                {t("backup_all")}
              </Button>
            </div>
          </div>

          <CheckboxField
            label={t("include_disabled_games")}
            checked={includeDisabledBulk}
            disabled={busy}
            onChange={(e) => setIncludeDisabledBulk(e.target.checked)}
          />

          {bulk.running && (
            <div className="local-edition__scan-progress" role="status">
              <span>
                {t("backup_all_running", {
                  completed: bulk.completed,
                  total: bulk.total,
                  title: bulk.currentGameTitle ?? "",
                })}
              </span>
              <progress value={bulk.completed} max={Math.max(bulk.total, 1)} />
            </div>
          )}

          {lastBulkSummary && !bulk.running && (
            <div className="local-edition__subcard">
              <p className="local-edition__status-banner" role="status">
                {t("bulk_summary", {
                  succeeded: lastBulkSummary.succeeded,
                  skipped: lastBulkSummary.skipped,
                  failed: lastBulkSummary.failed,
                })}
              </p>
              {bulkIssueCount > 0 && (
                <details>
                  <summary>
                    {t("bulk_skipped_details", { count: bulkIssueCount })}
                  </summary>
                  <ul className="local-edition__bulk-issues">
                    {lastBulkSummary.failures.map((item) => (
                      <li key={`fail-${item.gameKey}`}>
                        <strong className="local-edition__error">
                          {t("bulk_failed_label")}
                        </strong>{" "}
                        · {item.title}: {item.reason}
                      </li>
                    ))}
                    {lastBulkSummary.skippedGames.map((item) => (
                      <li key={`skip-${item.gameKey}`}>
                        <strong>{t("bulk_skipped_label")}</strong> ·{" "}
                        {item.title}: {item.reason}
                      </li>
                    ))}
                  </ul>
                </details>
              )}
            </div>
          )}

          {!state.games.length ? (
            <p className="local-edition__hint">{t("no_games")}</p>
          ) : (
            <>
              <div className="local-edition__search-box">
                <TextField
                  placeholder={t("overview_filter_placeholder")}
                  value={overviewFilter}
                  onChange={(e) => setOverviewFilter(e.target.value)}
                />
              </div>
              <div className="local-edition__table-scroll">
                <table className="local-edition__overview-table">
                  <thead>
                    <tr>
                      <th>{t("overview_col_game")}</th>
                      <th>{t("overview_col_status")}</th>
                      <th>{t("overview_col_auto")}</th>
                      <th>{t("overview_col_actions")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredGames.map((game) => {
                      const summary = state.gameSummaries?.[game.key];
                      const gameEnabled =
                        settings.games[game.key]?.enabled !== false;
                      const isActive = state.activeGameKey === game.key;

                      const statusNode = (() => {
                        if (isActive) {
                          return <span>{t("pill_backing_up")}</span>;
                        }
                        if (summary?.lastAttemptStatus === "failed") {
                          return (
                            <span
                              className="local-edition__error"
                              title={summary.lastError ?? t("status_failed")}
                            >
                              {t("pill_backup_failed")}
                              {summary.lastBackupAt
                                ? ` · ${formatDistance(
                                    new Date(summary.lastBackupAt),
                                    new Date(),
                                    { addSuffix: true }
                                  )}`
                                : ""}
                            </span>
                          );
                        }
                        if (summary?.lastBackupAt) {
                          return (
                            <span title={formatDateTime(summary.lastBackupAt)}>
                              {formatDistance(
                                new Date(summary.lastBackupAt),
                                new Date(),
                                { addSuffix: true }
                              )}
                            </span>
                          );
                        }
                        return (
                          <span className="local-edition__hint">
                            {t("never_backed_up")}
                          </span>
                        );
                      })();

                      return (
                        <tr key={game.key}>
                          <td>
                            <div className="local-edition__overview-game-cell">
                              <span>{game.title}</span>
                              {!game.executablePath && (
                                <span className="local-edition__badge local-edition__badge--unmatched">
                                  {t("not_installed_badge")}
                                </span>
                              )}
                            </div>
                          </td>
                          <td>{statusNode}</td>
                          <td>
                            <input
                              type="checkbox"
                              aria-label={`${t("enable_game")} (${game.title})`}
                              checked={gameEnabled}
                              disabled={busy}
                              onChange={(e) => {
                                const enabled = e.target.checked;
                                void action(async () => {
                                  const latest =
                                    await window.electron.saveLudusaviGameSettings(
                                      game.key,
                                      { enabled }
                                    );
                                  setSettings(latest.settings);
                                });
                              }}
                            />
                          </td>
                          <td>
                            <div className="local-edition__actions">
                              <Button
                                theme="outline"
                                disabled={busy}
                                onClick={() =>
                                  action(() =>
                                    window.electron.runLudusaviLocalBackup(
                                      game.key,
                                      false
                                    )
                                  )
                                }
                              >
                                {t("overview_backup_short")}
                              </Button>
                              <Button
                                theme="outline"
                                onClick={() => openGameBackups(game)}
                              >
                                {t("overview_manage")}
                              </Button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </section>

        <SettingsSaveDiscovery
          games={state.games}
          busy={busy}
          destination={settings.destination}
          beforeAction={save}
          refresh={refresh}
          onAdded={async () => {
            const latest = await refresh();
            setSettings(latest.settings);
            await updateLibrary();
          }}
        />

        <div className="local-edition__advanced-entry">
          <p className="local-edition__hint">
            {t("advanced_entry_description")}
          </p>
          <Button
            theme="outline"
            disabled={busy}
            onClick={() => setAdvancedOpen(true)}
          >
            {t("open_advanced_settings")}
          </Button>
        </div>
      </div>

      <section
        className="local-edition__advanced-view"
        hidden={!advancedOpen}
        aria-label={t("advanced_view_title")}
      >
        <div className="local-edition__view-toolbar">
          <Button
            theme="outline"
            disabled={working}
            onClick={() => setAdvancedOpen(false)}
          >
            {t("back_to_backups")}
          </Button>
          <Button disabled={busy} onClick={() => action(save)}>
            {t("save")}
          </Button>
        </div>
        <div>
          <h3
            ref={advancedHeading}
            tabIndex={-1}
            className="local-edition__card-title"
          >
            {t("advanced_view_title")}
          </h3>
          <p className="local-edition__card-subtitle">
            {t("advanced_view_description")}
          </p>
        </div>

        <div className="local-edition__advanced-body">
          <p className="local-edition__notice">{t("backup_only_notice")}</p>

          {/* Retention & Archive Format */}
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

          {/* Advanced Rules, Full Ludusavi Manager & Rclone Remote Storage */}
          <SettingsSaveManager
            mode="advanced"
            gameKey=""
            destination={settings.destination}
            busy={busy}
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
          <details className="local-edition__subdrawer">
            <summary>{t("engine_information")}</summary>
            <div className="local-edition__engine-information">
              <p>{t("engine_credit", { version: saveEngine.version })}</p>
              <p>{t("engine_update_policy")}</p>
            </div>
          </details>
        </div>
      </section>
    </div>
  );
}
