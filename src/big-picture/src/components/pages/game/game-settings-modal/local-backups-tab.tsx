import { getLocalSavePresentation } from "@renderer/pages/game-details/cloud-save-v2/local-save-presentation";
import { formatBytes } from "@shared";
import type { LibraryGame, LudusaviLocalResult } from "@types";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import {
  useBigPictureToast,
  useDate,
  useLudusaviLocalState,
} from "../../../../hooks";
import {
  Button,
  HorizontalFocusGroup,
  VerticalFocusGroup,
} from "../../../common";
import { SettingsSection } from "../../../../pages/settings/settings-section";
import "./local-backups-tab.scss";

export const GAME_LOCAL_BACKUPS_PRIMARY_CONTROL_ID =
  "game-local-backups-primary-control";
const GAME_LOCAL_BACKUPS_REGION_ID = "game-local-backups-settings-region";

interface LocalBackupsTabProps {
  game: LibraryGame;
  onSelectExecutable: () => void;
  onCloseModal: () => void;
}

export function GameLocalBackupsSettingsTab({
  game,
  onSelectExecutable,
  onCloseModal,
}: Readonly<LocalBackupsTabProps>) {
  const { t } = useTranslation("ludusavi");
  const { formatDateTime, formatDistance } = useDate();
  const navigate = useNavigate();
  const { showErrorToast, showSuccessToast } = useBigPictureToast();
  const gameKey = `${game.shop}:${game.objectId}`;
  const { state, error: stateError, refresh } = useLudusaviLocalState();

  const [working, setWorking] = useState(false);
  const [error, setError] = useState("");
  const [lastActionResult, setLastActionResult] =
    useState<LudusaviLocalResult | null>(null);

  useEffect(() => {
    setError("");
    setLastActionResult(null);
  }, [gameKey]);

  if (!state) {
    return (
      <VerticalFocusGroup
        regionId={GAME_LOCAL_BACKUPS_REGION_ID}
        className="game-local-backups-tab"
      >
        <SettingsSection
          title={t("title")}
          description={t("game_section_description")}
        >
          <p className="game-local-backups-tab__status-copy" role="status">
            {stateError || t("loading")}
          </p>
        </SettingsSection>
      </VerticalFocusGroup>
    );
  }

  const gameSettings = state.settings.games[gameKey] ?? {
    enabled: true,
    savePaths: [],
    trackingPaths: [],
  };
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
  const isAutoEnabled =
    state.settings.enabled && gameSettings.enabled !== false;

  const statusText = (() => {
    if (presentation.kind === "backing-up") return t("pill_backing_up");
    if (presentation.lastBackupAt) {
      return t("last_backup_at", {
        time: `${formatDistance(
          new Date(presentation.lastBackupAt),
          new Date(),
          { addSuffix: true }
        )} (${formatDateTime(presentation.lastBackupAt)})`,
      });
    }
    return t("last_backup_at", { time: t("never_backed_up") });
  })();

  const runAction = async (
    task: () => Promise<LudusaviLocalResult | null | undefined>,
    successTitle?: string
  ) => {
    setWorking(true);
    setError("");
    try {
      const result = await task();
      if (result) {
        setLastActionResult(result);
        if (result.status === "failed") {
          showErrorToast(t("status_failed"), {
            fallbackVisual: "settings",
            message: result.message,
          });
        } else if (successTitle) {
          showSuccessToast(successTitle, {
            fallbackVisual: "settings",
            message: result.message,
          });
        }
      }
      await refresh();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setError(message);
      showErrorToast(t("status_failed"), {
        fallbackVisual: "settings",
        message,
      });
    } finally {
      setWorking(false);
    }
  };

  const handleOpenGlobalSettings = () => {
    onCloseModal();
    navigate(
      `/big-picture/settings?tab=advanced&section=backups&game=${encodeURIComponent(gameKey)}`
    );
  };

  return (
    <VerticalFocusGroup
      regionId={GAME_LOCAL_BACKUPS_REGION_ID}
      className="game-local-backups-tab"
    >
      <SettingsSection
        title={t("title")}
        description={t("game_section_description")}
      >
        <div className="game-local-backups-tab__card">
          <div className="game-local-backups-tab__card-header">
            <div>
              <div className="game-local-backups-tab__title-row">
                <h4 className="game-local-backups-tab__game-title">
                  {game.title}
                </h4>
                <span
                  className={`game-local-backups-tab__badge ${
                    isAutoEnabled
                      ? "game-local-backups-tab__badge--enabled"
                      : "game-local-backups-tab__badge--disabled"
                  }`}
                >
                  {isAutoEnabled ? t("status_enabled") : t("status_disabled")}
                </span>
              </div>
              <p className="game-local-backups-tab__status-copy">
                {statusText}
              </p>
              {presentation.kind === "backed-up" && presentation.files > 0 && (
                <p className="game-local-backups-tab__hint">
                  {t("contents", {
                    files: presentation.files,
                    bytes: formatBytes(presentation.bytes),
                    registry: 0,
                  })}
                </p>
              )}
              {presentation.kind === "failed" && presentation.lastError && (
                <p className="game-local-backups-tab__error" role="alert">
                  {presentation.lastError}
                </p>
              )}
            </div>
          </div>

          <p className="game-local-backups-tab__hint">
            {t("automatic_backup_controlled_in_advanced")}
          </p>

          {error && (
            <p className="game-local-backups-tab__error" role="alert">
              {error}
            </p>
          )}

          {lastActionResult && (
            <p
              role={lastActionResult.status === "failed" ? "alert" : "status"}
              className={
                lastActionResult.status === "failed"
                  ? "game-local-backups-tab__error"
                  : "game-local-backups-tab__banner"
              }
            >
              {t(`status_${lastActionResult.status}`)}:{" "}
              {lastActionResult.message}
              {lastActionResult.status !== "failed" &&
                ` (${t("contents", {
                  files: lastActionResult.files,
                  bytes: formatBytes(lastActionResult.bytes),
                  registry: lastActionResult.registryKeys,
                })})`}
            </p>
          )}

          <HorizontalFocusGroup
            regionId="game-local-backups-primary-actions"
            className="game-local-backups-tab__actions"
          >
            <Button
              focusId={GAME_LOCAL_BACKUPS_PRIMARY_CONTROL_ID}
              variant="secondary"
              disabled={busy}
              onClick={() =>
                void runAction(() =>
                  globalThis.window.electron.runLudusaviLocalBackup(
                    gameKey,
                    true
                  )
                )
              }
            >
              {t("preview")}
            </Button>
            <Button
              variant="primary"
              disabled={busy}
              onClick={() =>
                void runAction(
                  () =>
                    globalThis.window.electron.runLudusaviLocalBackup(
                      gameKey,
                      false
                    ),
                  t("backup_now")
                )
              }
            >
              {t("backup_now")}
            </Button>
            <Button
              variant="secondary"
              disabled={busy}
              onClick={handleOpenGlobalSettings}
            >
              {t("open_advanced_save_settings")}
            </Button>
          </HorizontalFocusGroup>

          {!game.executablePath && (
            <div className="game-local-backups-tab__executable-row">
              <p className="game-local-backups-tab__hint">
                {t("executable_for_automation")}
              </p>
              <Button variant="secondary" onClick={onSelectExecutable}>
                {t("game_set_executable")}
              </Button>
            </div>
          )}
        </div>
      </SettingsSection>
    </VerticalFocusGroup>
  );
}
