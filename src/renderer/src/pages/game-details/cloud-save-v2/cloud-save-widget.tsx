import localEdition from "../../../../../shared/local-edition.json";
import { useTranslation } from "react-i18next";
import { useContext, useMemo } from "react";
import { gameDetailsContext } from "@renderer/context";
import { useDate, useLudusaviLocalState } from "@renderer/hooks";
import { formatBytes } from "@shared";

import type { CloudSaveSyncProgressPayload } from "@types";

import { CloudSaveStatusIcon } from "./cloud-save-status-icon";
import { getCloudSavePresentation } from "./cloud-save-presentation";
import { getLocalSavePresentation } from "./local-save-presentation";
import { useCloudSaveV2 } from "./cloud-save-v2-context";
import "./cloud-save-v2.scss";

const getProgressPercentage = (
  progress: CloudSaveSyncProgressPayload | null
) => {
  if (!progress) return 0;
  if (progress.stage === "completed") return 100;
  if (progress.totalFiles <= 0) return 0;

  const percentage = (progress.processedFiles / progress.totalFiles) * 100;
  return Math.min(100, Math.max(0, percentage));
};

function HydraCloudSaveWidget() {
  const { t } = useTranslation("game_details");
  const {
    overview,
    isRefreshing,
    isSyncing,
    hasError,
    progress,
    hasExecutablePath,
    canUseCloudSaves,
    openManager,
  } = useCloudSaveV2();

  const isChecking = hasExecutablePath && isRefreshing && !overview;
  const presentation = getCloudSavePresentation({
    canUseCloudSaves,
    hasExecutablePath,
    isChecking,
    isSyncing,
    hasError,
    hasUnconfiguredCustomPaths:
      (overview?.unconfiguredCustomPathCount ?? 0) > 0,
    state: overview?.state ?? null,
    progressStage: isSyncing ? (progress?.stage ?? null) : null,
  });
  const progressPercentage = getProgressPercentage(progress);
  const showSyncProgress =
    presentation.labelKey === "cloud_save_v2_syncing" && isSyncing;

  return (
    <button
      type="button"
      className={`game-details__cloud-sync-button cloud-save-v2__trigger cloud-save-v2__trigger--${presentation.tone}`}
      onClick={openManager}
      title={t("cloud_save")}
    >
      <CloudSaveStatusIcon icon={presentation.icon} />
      {t(presentation.labelKey)}
      {showSyncProgress && (
        <span
          aria-hidden="true"
          className="cloud-save-v2__sync-progress-bar"
          style={{ width: `${progressPercentage}%` }}
        />
      )}
    </button>
  );
}

function LocalSaveBackupWidget() {
  const { t } = useTranslation("ludusavi");
  const { formatDistance, formatDateTime } = useDate();
  const {
    shop,
    objectId,
    game,
    setGameOptionsInitialCategory,
    setShowGameOptionsModal,
  } = useContext(gameDetailsContext);
  const { state } = useLudusaviLocalState();

  const gameKey = shop && objectId ? `${shop}:${objectId}` : null;
  const gameSettings = gameKey ? state?.settings.games[gameKey] : undefined;
  const summary = gameKey ? state?.gameSummaries?.[gameKey] : undefined;
  const hasExecutablePath = Boolean(
    game?.executablePath || gameSettings?.trackingPaths?.length
  );

  const presentation = useMemo(
    () =>
      getLocalSavePresentation({
        globalEnabled: state?.settings.enabled ?? true,
        gameEnabled: gameSettings?.enabled !== false,
        hasExecutablePath,
        isBackingUp: Boolean(gameKey && state?.activeGameKey === gameKey),
        summary,
      }),
    [
      state?.settings.enabled,
      state?.activeGameKey,
      gameSettings?.enabled,
      hasExecutablePath,
      gameKey,
      summary,
    ]
  );

  const label = (() => {
    if (!state && presentation.kind === "ready") {
      return t("title");
    }
    switch (presentation.kind) {
      case "backing-up":
        return t("pill_backing_up");
      case "failed":
        return t("pill_backup_failed");
      case "backed-up":
        return t("pill_backed_up", {
          time: formatDistance(
            new Date(presentation.lastBackupAt!),
            new Date(),
            {
              addSuffix: true,
            }
          ),
        });
      case "disabled":
        return t("pill_backups_off");
      case "no-executable":
      case "ready":
      default:
        return t("pill_no_backups");
    }
  })();

  const tooltip = (() => {
    switch (presentation.kind) {
      case "backing-up":
        return t("pill_backing_up");
      case "failed":
        return presentation.lastBackupAt
          ? t("tooltip_failed_with_previous", {
              error: presentation.lastError || t("status_failed"),
              date: formatDateTime(presentation.lastBackupAt),
            })
          : t("tooltip_failed", {
              error: presentation.lastError || t("status_failed"),
            });
      case "backed-up":
        return t("tooltip_backed_up", {
          date: formatDateTime(presentation.lastBackupAt!),
          summary: `${presentation.files} files · ${formatBytes(presentation.bytes)}`,
        });
      case "disabled":
        return t("tooltip_disabled");
      case "no-executable":
        return t("tooltip_no_executable");
      case "ready":
      default:
        return t("tooltip_ready");
    }
  })();

  const handleClick = () => {
    if (game && objectId) {
      setGameOptionsInitialCategory("local_backups");
      setShowGameOptionsModal(true);
      return;
    }
    const query = new URLSearchParams({ tab: "local_backups" });
    if (gameKey) query.set("game", gameKey);
    globalThis.location.hash = `/settings?${query}`;
  };

  return (
    <button
      type="button"
      className={`game-details__cloud-sync-button cloud-save-v2__trigger cloud-save-v2__trigger--${presentation.tone}`}
      onClick={handleClick}
      title={tooltip}
    >
      <CloudSaveStatusIcon icon={presentation.icon} />
      {label}
    </button>
  );
}

export function CloudSaveWidget() {
  if (!localEdition.hideCloudPromotions) return <HydraCloudSaveWidget />;
  return <LocalSaveBackupWidget />;
}
