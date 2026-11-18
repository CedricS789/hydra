import { useState, useCallback, useEffect, useMemo } from "react";
import { useTranslation } from "react-i18next";
import type { GameUninstallPlan, LibraryGame } from "@types";
import {
  applyLibraryGroupAction,
  findLibraryGamePresentation,
  getLibraryGameMembers,
  getOfficialStoreMembers,
  getRemoveFilesTarget,
  isLibraryGameDownloading,
  isSameRemoveFilesTarget,
  resolveDangerZonePreferences,
  type RemoveFilesTarget,
} from "@shared";
import { useIsSteamLibraryExecutable } from "@renderer/hooks/use-steam-library-executable";
import { Button, VerticalFocusGroup } from "../../../common";
import { ConfirmationModal } from "../../../modals";
import { useSourceArchive } from "@renderer/hooks/use-source-archive";
import { SettingsSection } from "../../../../pages/settings/settings-section";
import { useBigPictureToast } from "../../../../hooks/use-big-picture-toast.hook";
import { Feature, useFeature, useUserPreferences } from "../../../../hooks";
import { MyScreenshotsDangerSection } from "./my-screenshots-danger-section";

import "./danger-zone-tab.scss";

function getInstalledDescription(
  game: LibraryGame,
  plan: GameUninstallPlan | null,
  t: (key: string, options?: Record<string, unknown>) => string
) {
  if (!plan) {
    return t("uninstall_game_section_description", { game: game.title });
  }
  if (plan.nativeUninstaller) {
    return t("uninstall_game_native_description", {
      game: game.title,
      label: plan.nativeUninstaller.label,
    });
  }
  if (plan.canDeleteGameRoot && plan.gameRoot) {
    return t("uninstall_game_folder_description", {
      game: game.title,
      path: plan.gameRoot,
    });
  }
  return t("uninstall_game_blocked_description");
}

function getConfirmationConfig(
  pendingAction: DangerAction,
  game: LibraryGame,
  pendingRemoveFilesTarget: RemoveFilesTarget | null,
  uninstallPlan: GameUninstallPlan | null,
  t: (key: string, options?: Record<string, unknown>) => string,
  handleRemoveFromLibrary: () => Promise<void>,
  handleResetAchievements: () => Promise<void>,
  handleRemoveFiles: () => Promise<void>
) {
  switch (pendingAction) {
    case "remove-from-library":
      return {
        title: t("remove_from_library"),
        description: t("remove_from_library_description", { game: game.title }),
        confirmLabel: t("remove_from_library"),
        onConfirm: handleRemoveFromLibrary,
      };
    case "reset-achievements":
      return {
        title: t("reset_achievements"),
        description: t(
          game.shop === "steam"
            ? "reset_achievements_steam_description"
            : "reset_achievements_souvenirs_description",
          { game: game.title }
        ),
        confirmLabel: t("reset_achievements"),
        onConfirm: handleResetAchievements,
      };
    case "remove-files":
      if (pendingRemoveFilesTarget?.kind === "steam") {
        return {
          title: t("remove_game_files_steam_title"),
          description: t("remove_game_files_steam_description", {
            game: pendingRemoveFilesTarget.game.title,
          }),
          confirmLabel: t("remove_game_files_steam_confirm"),
          onConfirm: handleRemoveFiles,
        };
      }
      if (pendingRemoveFilesTarget?.kind === "installed") {
        return {
          title: t("uninstall_game_title", {
            game: pendingRemoveFilesTarget.game.title,
          }),
          description: getInstalledDescription(
            pendingRemoveFilesTarget.game,
            uninstallPlan,
            t
          ),
          confirmLabel: t("uninstall_game_confirm"),
          onConfirm: handleRemoveFiles,
        };
      }
      return {
        title: t("remove_game_files"),
        description: t("remove_game_files_description", {
          game: pendingRemoveFilesTarget?.game.title ?? game.title,
        }),
        confirmLabel: t("remove_game_files"),
        onConfirm: handleRemoveFiles,
      };
  }
}

export const GAME_DANGER_ZONE_PRIMARY_CONTROL_ID =
  "game-danger-zone-primary-control";

interface GameDangerZoneSettingsTabProps {
  game: LibraryGame;
  removeFilesGame?: LibraryGame;
  onClose: () => void;
}

type DangerAction =
  | "remove-from-library"
  | "reset-achievements"
  | "remove-files";

export function GameDangerZoneSettingsTab({
  game,
  removeFilesGame,
  onClose,
}: Readonly<GameDangerZoneSettingsTabProps>) {
  const { t } = useTranslation("big_picture");
  const { showSuccessToast, showErrorToast } = useBigPictureToast();
  const { isFeatureEnabled } = useFeature();
  const userPreferences = useUserPreferences();
  const dangerZone = resolveDangerZonePreferences(userPreferences);
  const showRemoveFromLibrary = dangerZone.enableDangerZoneRemoveFromLibrary;
  const showResetAchievements =
    game.shop !== "custom" && dangerZone.enableDangerZoneResetAchievements;
  const showMyScreenshots =
    isFeatureEnabled(Feature.Screenshots) &&
    dangerZone.enableDangerZoneDeleteScreenshots;
  const firstVisibleSection = showRemoveFromLibrary
    ? "remove-from-library"
    : showResetAchievements
      ? "reset-achievements"
      : dangerZone.enableDangerZoneRemoveGameFiles
        ? "remove-files"
        : "my-screenshots";
  const [pendingAction, setPendingAction] = useState<DangerAction | null>(null);
  const [pendingRemoveFilesTarget, setPendingRemoveFilesTarget] =
    useState<RemoveFilesTarget | null>(null);
  const [uninstallPlan, setUninstallPlan] =
    useState<GameUninstallPlan | null>(null);
  const [actionLoading, setActionLoading] = useState(false);
  const [deleteSourceArchive, setDeleteSourceArchive] = useState(false);
  const hasSourceArchive = useSourceArchive(
    pendingRemoveFilesTarget?.kind === "hydra" ||
      pendingRemoveFilesTarget?.kind === "installed"
      ? pendingRemoveFilesTarget.game
      : null,
    pendingAction === "remove-files"
  );

  useEffect(() => {
    setDeleteSourceArchive(false);
  }, [pendingAction]);

  const steamUninstallAvailable =
    typeof globalThis.window.electron.uninstallGameOnSteam === "function";
  const installedUninstallAvailable =
    typeof globalThis.window.electron.inspectGameUninstall === "function" &&
    typeof globalThis.window.electron.uninstallGame === "function";
  const removeFilesSource = useMemo(
    () => removeFilesGame ?? game,
    [removeFilesGame, game]
  );
  const baseHydraTarget = getRemoveFilesTarget(
    removeFilesSource,
    false,
    false,
    false
  );
  const hasDownloadPath = baseHydraTarget !== null;
  const steamMember = getOfficialStoreMembers(
    getLibraryGameMembers(removeFilesSource)
  ).steam;
  const isSteamLibraryExecutable = useIsSteamLibraryExecutable(
    steamMember,
    !hasDownloadPath
  );
  const removeFilesTarget = getRemoveFilesTarget(
    removeFilesSource,
    steamUninstallAvailable,
    hasDownloadPath ? false : isSteamLibraryExecutable,
    installedUninstallAvailable
  );
  const showRemoveFiles =
    dangerZone.enableDangerZoneRemoveGameFiles &&
    (game.shop !== "custom" || removeFilesTarget !== null);
  const isGameDownloading =
    (removeFilesTarget?.kind === "hydra" ||
      removeFilesTarget?.kind === "installed") &&
    isLibraryGameDownloading(removeFilesTarget.game);
  const removeFilesSectionTitle =
    removeFilesTarget?.kind === "steam"
      ? t("remove_game_files_steam_title")
      : removeFilesTarget?.kind === "installed"
        ? t("uninstall_game_section_title")
        : t("remove_game_files");
  const removeFilesSectionDescription =
    removeFilesTarget?.kind === "steam"
      ? t("remove_game_files_steam_description", {
          game: removeFilesTarget.game.title,
        })
      : removeFilesTarget?.kind === "installed"
        ? t("uninstall_game_section_description")
        : t("remove_game_files_description", {
            game: removeFilesTarget?.game.title ?? game.title,
          });

  useEffect(() => {
    if (
      pendingAction !== "remove-files" ||
      pendingRemoveFilesTarget?.kind !== "installed" ||
      !installedUninstallAvailable
    ) {
      setUninstallPlan(null);
      return;
    }

    let cancelled = false;
    void globalThis.window.electron
      .inspectGameUninstall?.(
        pendingRemoveFilesTarget.game.shop,
        pendingRemoveFilesTarget.game.objectId
      )
      .then((nextPlan) => {
        if (!cancelled) setUninstallPlan(nextPlan ?? null);
      })
      .catch(() => {
        if (!cancelled) setUninstallPlan(null);
      });

    return () => {
      cancelled = true;
    };
  }, [
    pendingAction,
    pendingRemoveFilesTarget,
    installedUninstallAvailable,
  ]);

  const clearPendingAction = useCallback(() => {
    setPendingAction(null);
    setPendingRemoveFilesTarget(null);
    setUninstallPlan(null);
  }, []);

  const handleRemoveFromLibrary = useCallback(async () => {
    setActionLoading(true);
    try {
      const library = await globalThis.window.electron.getLibrary(true);
      const members = findLibraryGamePresentation(library, game)?.members ?? [
        game,
      ];
      await applyLibraryGroupAction(members, async (member) => {
        if (member.download)
          await globalThis.window.electron.cancelGameDownload(
            member.shop,
            member.objectId
          );
        await globalThis.window.electron.removeGameFromLibrary(
          member.shop,
          member.objectId
        );
      });
      showSuccessToast("Game removed from library");
      clearPendingAction();
      onClose();
    } catch {
      showErrorToast("Failed to remove from library");
    } finally {
      globalThis.window.dispatchEvent(new Event("library-update"));
      setActionLoading(false);
    }
  }, [game, onClose, showSuccessToast, showErrorToast, clearPendingAction]);

  const handleResetAchievements = useCallback(async () => {
    setActionLoading(true);
    try {
      await globalThis.window.electron.resetGameAchievements(
        game.shop,
        game.objectId
      );
      showSuccessToast("Achievements reset");
      clearPendingAction();
    } catch {
      showErrorToast("Failed to reset achievements");
    } finally {
      setActionLoading(false);
    }
  }, [game, showSuccessToast, showErrorToast, clearPendingAction]);

  const handleRemoveFiles = useCallback(async () => {
    const pendingTarget = pendingRemoveFilesTarget;
    if (!pendingTarget) return;

    setActionLoading(true);
    try {
      const liveTarget = getRemoveFilesTarget(
        removeFilesSource,
        steamUninstallAvailable,
        hasDownloadPath ? false : isSteamLibraryExecutable,
        installedUninstallAvailable
      );
      if (!liveTarget || !isSameRemoveFilesTarget(liveTarget, pendingTarget)) {
        showErrorToast(t("remove_game_files_target_changed"));
        clearPendingAction();
        return;
      }

      if (
        (liveTarget.kind === "hydra" || liveTarget.kind === "installed") &&
        isLibraryGameDownloading(liveTarget.game)
      ) {
        showErrorToast(t("remove_game_files_downloading"));
        clearPendingAction();
        return;
      }

      if (liveTarget.kind === "steam") {
        await globalThis.window.electron.uninstallGameOnSteam?.(
          liveTarget.appId
        );
        showSuccessToast(t("steam_uninstall_requested"));
        clearPendingAction();
        return;
      }

      if (liveTarget.kind === "installed" && installedUninstallAvailable) {
        const plan =
          uninstallPlan ??
          (await globalThis.window.electron.inspectGameUninstall?.(
            liveTarget.game.shop,
            liveTarget.game.objectId
          ));
        if (!plan || plan.activityBlock) {
          showErrorToast(t("uninstall_game_failed"));
          return;
        }
        const mode = plan.nativeUninstaller
          ? "native-uninstaller"
          : "folder-delete";
        const result = await globalThis.window.electron.uninstallGame?.(
          liveTarget.game.shop,
          liveTarget.game.objectId,
          {
            mode,
            deleteDownloadFolder: plan.hasDownloadFolder,
            deleteSourceArchive: plan.hasSourceArchive && deleteSourceArchive,
          }
        );
        if (!result || result.status === "blocked") {
          showErrorToast(t("uninstall_game_blocked_description"));
          return;
        }
        if (result.status === "cancelled-by-user") {
          showErrorToast(t("uninstall_game_cancelled"));
          return;
        }
        showSuccessToast(
          result.status === "uninstaller-launched"
            ? t("uninstall_game_launched")
            : t("uninstall_game_success")
        );
        clearPendingAction();
        globalThis.window.dispatchEvent(new Event("library-update"));
        return;
      }

      await globalThis.window.electron.deleteGameFolder(
        liveTarget.game.shop,
        liveTarget.game.objectId,
        { deleteSourceArchive: hasSourceArchive && deleteSourceArchive }
      );
      showSuccessToast("Game files removed");
      clearPendingAction();
      globalThis.window.dispatchEvent(new Event("library-update"));
    } catch {
      showErrorToast(
        pendingTarget.kind === "steam"
          ? t("steam_uninstall_failed")
          : pendingTarget.kind === "installed"
            ? t("uninstall_game_failed")
            : t("remove_game_files_failed")
      );
    } finally {
      setActionLoading(false);
    }
  }, [
    removeFilesSource,
    steamUninstallAvailable,
    hasDownloadPath,
    isSteamLibraryExecutable,
    installedUninstallAvailable,
    pendingRemoveFilesTarget,
    uninstallPlan,
    t,
    showSuccessToast,
    showErrorToast,
    clearPendingAction,
    hasSourceArchive,
    deleteSourceArchive,
  ]);

  const isPendingActionAllowed =
    (pendingAction === "remove-from-library" && showRemoveFromLibrary) ||
    (pendingAction === "reset-achievements" && showResetAchievements) ||
    (pendingAction === "remove-files" && showRemoveFiles);

  const confirmationConfig =
    pendingAction && isPendingActionAllowed
      ? getConfirmationConfig(
          pendingAction,
          game,
          pendingRemoveFilesTarget,
          uninstallPlan,
          t,
          handleRemoveFromLibrary,
          handleResetAchievements,
          handleRemoveFiles
        )
      : null;

  return (
    <VerticalFocusGroup className="game-danger-zone-settings-tab">
      {showRemoveFromLibrary && (
        <SettingsSection
          className="game-danger-zone-settings-tab__section"
          title={t("remove_from_library")}
          description={t("remove_from_library_description", {
            game: game.title,
          })}
        >
          <Button
            focusId={
              firstVisibleSection === "remove-from-library"
                ? GAME_DANGER_ZONE_PRIMARY_CONTROL_ID
                : undefined
            }
            variant="danger"
            className="game-danger-zone-settings-tab__action-button"
            onClick={() => setPendingAction("remove-from-library")}
          >
            {t("remove_from_library")}
          </Button>
        </SettingsSection>
      )}

      {showResetAchievements && (
        <SettingsSection
          className="game-danger-zone-settings-tab__section"
          title={t("reset_achievements")}
          description={t(
            game.shop === "steam"
              ? "reset_achievements_steam_description"
              : "reset_achievements_description",
            { game: game.title }
          )}
        >
          <Button
            focusId={
              firstVisibleSection === "reset-achievements"
                ? GAME_DANGER_ZONE_PRIMARY_CONTROL_ID
                : undefined
            }
            variant="danger"
            className="game-danger-zone-settings-tab__action-button"
            disabled={!game.achievementCount}
            onClick={() => setPendingAction("reset-achievements")}
          >
            {t("reset_achievements")}
          </Button>
        </SettingsSection>
      )}

      {showRemoveFiles && (
        <SettingsSection
          className="game-danger-zone-settings-tab__section"
          title={removeFilesSectionTitle}
          description={removeFilesSectionDescription}
        >
          <Button
            focusId={
              firstVisibleSection === "remove-files"
                ? GAME_DANGER_ZONE_PRIMARY_CONTROL_ID
                : undefined
            }
            variant="danger"
            className="game-danger-zone-settings-tab__action-button"
            disabled={!removeFilesTarget || isGameDownloading}
            onClick={() => {
              if (!removeFilesTarget || isGameDownloading) return;
              setPendingRemoveFilesTarget(removeFilesTarget);
              setPendingAction("remove-files");
            }}
          >
            {removeFilesTarget?.kind === "installed"
              ? t("uninstall_game_confirm")
              : t("remove_game_files")}
          </Button>
        </SettingsSection>
      )}

      {showMyScreenshots ? (
        <MyScreenshotsDangerSection
          shop={game.shop}
          objectId={game.objectId}
          fallbackFocusId={GAME_DANGER_ZONE_PRIMARY_CONTROL_ID}
          primaryFocusId={
            firstVisibleSection === "my-screenshots"
              ? GAME_DANGER_ZONE_PRIMARY_CONTROL_ID
              : undefined
          }
        />
      ) : null}

      {confirmationConfig && (
        <ConfirmationModal
          visible={true}
          title={confirmationConfig.title}
          description={confirmationConfig.description}
          confirmLabel={confirmationConfig.confirmLabel}
          danger
          loading={actionLoading}
          onClose={clearPendingAction}
          onConfirm={confirmationConfig.onConfirm}
          sourceArchiveOption={
            pendingAction === "remove-files" && hasSourceArchive
              ? {
                  checked: deleteSourceArchive,
                  onChange: setDeleteSourceArchive,
                }
              : null
          }
        />
      )}
    </VerticalFocusGroup>
  );
}
