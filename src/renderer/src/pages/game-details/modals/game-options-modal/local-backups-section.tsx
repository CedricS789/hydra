import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import type { LibraryGame, LudusaviLocalResult } from "@types";
import { formatBytes } from "@shared";
import { Button, CheckboxField } from "@renderer/components";
import { useDate, useLudusaviLocalState } from "@renderer/hooks";
import { SettingsSaveManager } from "@renderer/pages/settings/settings-save-manager";
import { getLocalSavePresentation } from "../../cloud-save-v2/local-save-presentation";
import "@renderer/pages/settings/settings-local-edition.scss";

interface LocalBackupsSectionProps {
  game: LibraryGame;
  onSelectExecutable: () => void;
  onOpenGlobalSettings: () => void;
}

/**
 * Per-game Ludusavi local save backups, recovery, and path configuration panel.
 */
export function LocalBackupsSection({
  game,
  onSelectExecutable,
  onOpenGlobalSettings,
}: Readonly<LocalBackupsSectionProps>) {
  const { t } = useTranslation("ludusavi");
  const { formatDateTime, formatDistance } = useDate();
  const gameKey = `${game.shop}:${game.objectId}`;
  const { state, refresh } = useLudusaviLocalState();

  const [working, setWorking] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [lastActionResult, setLastActionResult] =
    useState<LudusaviLocalResult | null>(null);
  const [savePathsText, setSavePathsText] = useState("");
  const [trackingPathsText, setTrackingPathsText] = useState("");
  const [pathsDirty, setPathsDirty] = useState(false);

  const gameSettings = state?.settings.games[gameKey] ?? {
    enabled: true,
    savePaths: [],
    trackingPaths: [],
  };

  useEffect(() => {
    setPathsDirty(false);
    setError("");
    setNotice("");
    setLastActionResult(null);
  }, [gameKey]);

  useEffect(() => {
    if (!state || pathsDirty) return;
    setSavePathsText(gameSettings.savePaths.join("\n"));
    setTrackingPathsText(gameSettings.trackingPaths.join("\n"));
  }, [state, pathsDirty, gameSettings.savePaths, gameSettings.trackingPaths]);

  if (!state) {
    return (
      <div className="game-options-modal__cloud-panel game-options-modal__cloud-panel--v2">
        <p role="status">{t("loading")}</p>
      </div>
    );
  }

  const hasExecutablePath = Boolean(
    game.executablePath || gameSettings.trackingPaths.length
  );
  const isBackingUp = state.activeGameKey === gameKey;
  const summary = state.gameSummaries?.[gameKey];
  const presentation = getLocalSavePresentation({
    globalEnabled: state.settings.enabled,
    gameEnabled: gameSettings.enabled !== false,
    hasExecutablePath,
    isBackingUp,
    summary,
  });

  const busy = working || state.busy;

  const runAction = async (task: () => Promise<void>) => {
    setWorking(true);
    setError("");
    setNotice("");
    try {
      await task();
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setWorking(false);
    }
  };

  const persistPendingPaths = async () => {
    if (!pathsDirty) return;
    await window.electron.saveLudusaviGameSettings(gameKey, {
      savePaths: savePathsText
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean),
      trackingPaths: trackingPathsText
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean),
    });
    setPathsDirty(false);
  };

  const statusText = (() => {
    if (presentation.kind === "backing-up") return t("pill_backing_up");
    if (presentation.lastBackupAt) {
      return t("last_backup_at", {
        time: `${formatDistance(
          new Date(presentation.lastBackupAt),
          new Date(),
          {
            addSuffix: true,
          }
        )} (${formatDateTime(presentation.lastBackupAt)})`,
      });
    }
    return t("last_backup_at", { time: t("never_backed_up") });
  })();

  return (
    <div className="game-options-modal__cloud-panel game-options-modal__cloud-panel--v2 local-edition local-edition--backups">
      <div className="game-options-modal__panel-header">
        <h2>{t("title")}</h2>
        <p>{t("game_section_description")}</p>
      </div>

      {error && (
        <p role="alert" className="local-edition__error">
          {error}
        </p>
      )}
      {notice && (
        <p role="status" className="local-edition__status-banner">
          {notice}
        </p>
      )}
      {lastActionResult && (
        <p
          role={lastActionResult.status === "failed" ? "alert" : "status"}
          className={
            lastActionResult.status === "failed"
              ? "local-edition__error"
              : "local-edition__status-banner"
          }
        >
          {t(`status_${lastActionResult.status}`)}: {lastActionResult.message}
          {lastActionResult.status !== "failed" &&
            ` (${t("contents", {
              files: lastActionResult.files,
              bytes: formatBytes(lastActionResult.bytes),
              registry: lastActionResult.registryKeys,
            })})`}
        </p>
      )}

      <div className="local-edition__subcard">
        <div className="local-edition__card-header">
          <div>
            <div className="local-edition__title-with-badge">
              <h4 className="local-edition__section-heading">{game.title}</h4>
              <span
                className={`local-edition__badge ${
                  state.settings.enabled && gameSettings.enabled !== false
                    ? "local-edition__badge--library"
                    : "local-edition__badge--unmatched"
                }`}
              >
                {state.settings.enabled && gameSettings.enabled !== false
                  ? t("status_enabled")
                  : t("status_disabled")}
              </span>
            </div>
            <p className="local-edition__hint">{statusText}</p>
            {presentation.kind === "failed" && presentation.lastError && (
              <p className="local-edition__error">{presentation.lastError}</p>
            )}
          </div>
          <Button theme="outline" onClick={onOpenGlobalSettings}>
            {t("open_global_settings")}
          </Button>
        </div>

        <CheckboxField
          label={t("enable_game")}
          checked={gameSettings.enabled !== false}
          disabled={busy}
          onChange={(e) => {
            const checked = e.target.checked;
            void runAction(async () => {
              await window.electron.saveLudusaviGameSettings(gameKey, {
                enabled: checked,
              });
            });
          }}
        />
        <p className="local-edition__hint">
          {t("game_auto_backup_description")}
        </p>

        {!game.executablePath && (
          <div className="local-edition__row">
            <span className="local-edition__hint">
              {t("executable_for_automation")}
            </span>
            <Button theme="outline" onClick={onSelectExecutable}>
              {t("game_set_executable")}
            </Button>
          </div>
        )}

        <div className="local-edition__row">
          <Button
            theme="outline"
            disabled={busy}
            onClick={() =>
              void runAction(async () => {
                await persistPendingPaths();
                const res = await window.electron.runLudusaviLocalBackup(
                  gameKey,
                  true
                );
                if (res) setLastActionResult(res);
              })
            }
          >
            {t("preview")}
          </Button>
          <Button
            disabled={busy}
            onClick={() =>
              void runAction(async () => {
                await persistPendingPaths();
                const res = await window.electron.runLudusaviLocalBackup(
                  gameKey,
                  false
                );
                if (res) setLastActionResult(res);
              })
            }
          >
            {t("backup_now")}
          </Button>
        </div>
      </div>

      <div className="local-edition__subcard">
        <SettingsSaveManager
          mode="versions"
          gameKey={gameKey}
          destination={state.settings.destination}
          busy={busy}
          beforeAction={persistPendingPaths}
          refresh={refresh}
          reloadSettings={async () => {
            await refresh();
          }}
        />
      </div>

      <details className="local-edition__advanced">
        <summary className="local-edition__advanced-summary">
          <div>
            <span className="local-edition__advanced-title">
              {t("game_custom_paths_title")}
            </span>
            <span className="local-edition__advanced-subtitle">
              {t("game_custom_paths_description")}
            </span>
          </div>
        </summary>
        <div className="local-edition__subcard">
          {gameSettings.manifestTitle && (
            <div className="local-edition__row">
              <span className="local-edition__hint">
                {t("linked_save_title", {
                  title: gameSettings.manifestTitle,
                })}
              </span>
              <Button
                theme="outline"
                disabled={busy}
                onClick={() =>
                  void runAction(async () => {
                    await window.electron.saveLudusaviGameSettings(gameKey, {
                      manifestTitle: undefined,
                      steamId: undefined,
                    });
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
              value={savePathsText}
              onChange={(e) => {
                setSavePathsText(e.target.value);
                setPathsDirty(true);
              }}
            />
          </label>

          <label className="local-edition__label">
            {t("tracking_paths")}
            <textarea
              rows={2}
              value={trackingPathsText}
              onChange={(e) => {
                setTrackingPathsText(e.target.value);
                setPathsDirty(true);
              }}
            />
          </label>

          <div className="local-edition__row">
            <Button
              theme="outline"
              disabled={busy || !pathsDirty}
              onClick={() =>
                void runAction(async () => {
                  await persistPendingPaths();
                  setNotice(t("custom_paths_saved"));
                })
              }
            >
              {t("save_custom_paths")}
            </Button>
          </div>

          <hr
            style={{
              width: "100%",
              border: 0,
              borderTop: "1px solid rgba(255, 255, 255, 0.08)",
            }}
          />

          <h4 className="local-edition__section-heading">
            {t("remote_title")}
          </h4>
          <p className="local-edition__hint">{t("remote_description")}</p>
          <SettingsSaveManager
            mode="remote"
            gameKey={gameKey}
            destination={state.settings.destination}
            busy={busy}
            beforeAction={persistPendingPaths}
            refresh={refresh}
            reloadSettings={async () => {
              await refresh();
            }}
          />
        </div>
      </details>
    </div>
  );
}
