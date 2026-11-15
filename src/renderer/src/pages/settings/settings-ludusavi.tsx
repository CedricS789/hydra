import { useSettingsOperationGuard } from "@renderer/context/settings/settings-draft.context";
import { useContext, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { Button, CheckboxField, TextField } from "@renderer/components";
import { settingsContext } from "@renderer/context";
import type { GameShop, LudusaviLocalSettings } from "@types";
import "./settings-local-edition.scss";
import { SettingsSaveDiscovery } from "./settings-save-discovery";
import { useDate, useLibrary, useLudusaviLocalState } from "@renderer/hooks";
import { useGameOptionsModal } from "@renderer/context/game-options-modal/game-options-modal.context";
import { buildGameDetailsPath } from "@renderer/helpers";

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
  const { setCurrentCategoryId } = useContext(settingsContext);
  const navigate = useNavigate();
  const { library, updateLibrary } = useLibrary();
  const { openGameOptionsModal } = useGameOptionsModal();
  const { state, error: stateError, refresh } = useLudusaviLocalState();

  const [settings, setSettings] = useState<LudusaviLocalSettings>();
  const [includeDisabledBulk, setIncludeDisabledBulk] = useState(false);
  const [overviewFilter, setOverviewFilter] = useState("");
  const mainHeading = useRef<HTMLHeadingElement>(null);
  const [working, setWorking] = useState(false);
  useSettingsOperationGuard("settings-ludusavi", working);
  const [error, setError] = useState("");
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

  // Main backup actions must never rewrite configuration as a side effect.
  const save = async () => {};

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
  const latestBackup = state.history.find(
    (result) => !result.operation || result.operation === "backup"
  );
  const lastBulkSummary = bulk.lastSummary;
  const bulkIssueCount = lastBulkSummary
    ? lastBulkSummary.skippedGames.length + lastBulkSummary.failures.length
    : 0;

  return (
    <div className="settings-context-panel local-edition local-edition--backups">
      {error && (
        <p role="alert" className="local-edition__error">
          {error}
        </p>
      )}
      <div className="local-edition__main-view">
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
            </div>
          </div>
          <p className="local-edition__hint">{t("cloud_notice")}</p>
        </section>

        {latestBackup && (
          <section
            className={`local-edition__latest-activity local-edition__latest-activity--${latestBackup.status}`}
            aria-label={t("latest_backup")}
          >
            <div>
              <h3 className="local-edition__section-heading">
                {t("latest_backup")}
              </h3>
              <p className="local-edition__hint">
                {formatDateTime(latestBackup.at)} · {latestBackup.title} ·{" "}
                {t("operation_backup")} · {t(`status_${latestBackup.status}`)}
              </p>
            </div>
            <p className="local-edition__latest-activity-message">
              {latestBackup.message}
            </p>
          </section>
        )}

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
                        settings.enabled &&
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
                            <span
                              className={`local-edition__badge ${
                                gameEnabled
                                  ? "local-edition__badge--library"
                                  : "local-edition__badge--unmatched"
                              }`}
                            >
                              {gameEnabled
                                ? t("status_enabled")
                                : t("status_disabled")}
                            </span>
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
            onClick={() => setCurrentCategoryId("advanced")}
          >
            {t("open_advanced_settings")}
          </Button>
        </div>
      </div>
    </div>
  );
}
