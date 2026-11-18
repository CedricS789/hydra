import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { formatBytes } from "@shared";
import type {
  ExecuteGameUninstallOptions,
  GameUninstallPlan,
  GameUninstallSafetyBlock,
  UninstallMethod,
} from "@types";

import { Button } from "../button/button";
import { CheckboxField } from "../checkbox-field/checkbox-field";
import { Modal } from "../modal/modal";
import { RadioField } from "../radio-field/radio-field";

import "./uninstall-game-modal.scss";

export interface UninstallGameModalProps {
  visible: boolean;
  gameTitle: string;
  plan: GameUninstallPlan | null;
  inspecting: boolean;
  inspectError?: boolean;
  loading?: boolean;
  onClose: () => void;
  onConfirm: (options: ExecuteGameUninstallOptions) => void;
}

const getBlockDescriptionKey = (block: GameUninstallSafetyBlock): string => {
  switch (block.reason) {
    case "game-running":
      return "uninstall_blocked_running";
    case "downloading":
      return "remove_files_downloading";
    case "transferring":
      return "uninstall_blocked_transferring";
    case "installer-running":
      return "uninstall_blocked_installer_running";
    case "shared-with-other-game":
      return "uninstall_blocked_shared_path";
    case "symlink-target":
      return "uninstall_blocked_symlink";
    case "missing-files":
      return "uninstall_blocked_missing_files";
    default:
      return "uninstall_blocked_unsafe_path";
  }
};

export function UninstallGameModal({
  visible,
  gameTitle,
  plan,
  inspecting,
  inspectError = false,
  loading = false,
  onClose,
  onConfirm,
}: Readonly<UninstallGameModalProps>) {
  const { t } = useTranslation("game_details");

  const [mode, setMode] = useState<UninstallMethod>("native-uninstaller");
  const [deleteDownloadFolder, setDeleteDownloadFolder] = useState(false);
  const [deleteSourceArchive, setDeleteSourceArchive] = useState(false);
  const [deleteWinePrefix, setDeleteWinePrefix] = useState(false);
  const [removeFromLibrary, setRemoveFromLibrary] = useState(false);

  useEffect(() => {
    if (!visible) return;
    setDeleteDownloadFolder(false);
    setDeleteSourceArchive(false);
    setDeleteWinePrefix(false);
    setRemoveFromLibrary(false);
  }, [visible]);

  useEffect(() => {
    if (!plan) return;
    if (plan.nativeUninstaller) {
      setMode("native-uninstaller");
    } else {
      setMode("folder-delete");
    }
  }, [plan]);

  const handleClose = () => {
    if (!loading) onClose();
  };

  const hasSourceArchiveOnlyCleanup = Boolean(
    !plan?.hasDownloadFolder && plan?.hasSourceArchive && deleteSourceArchive
  );
  const hasAnyExecutableAction = Boolean(
    plan &&
      !plan.activityBlock &&
      (plan.nativeUninstaller ||
        plan.canDeleteGameRoot ||
        plan.gameRootBlock?.reason === "missing-files" ||
        (plan.hasDownloadFolder && deleteDownloadFolder) ||
        hasSourceArchiveOnlyCleanup ||
        (plan.isolatedWinePrefixPath && deleteWinePrefix))
  );

  const canConfirm = Boolean(
    plan &&
      !inspecting &&
      !inspectError &&
      !loading &&
      !plan.activityBlock &&
      ((mode === "native-uninstaller" && plan.nativeUninstaller) ||
        (mode === "folder-delete" &&
          (plan.canDeleteGameRoot ||
            plan.gameRootBlock?.reason === "missing-files" ||
            (plan.hasDownloadFolder && deleteDownloadFolder) ||
            hasSourceArchiveOnlyCleanup ||
            (plan.isolatedWinePrefixPath && deleteWinePrefix))))
  );

  const handleConfirm = () => {
    if (!canConfirm) return;
    onConfirm({
      mode,
      deleteDownloadFolder: Boolean(
        (plan?.hasDownloadFolder && deleteDownloadFolder) ||
          hasSourceArchiveOnlyCleanup
      ),
      deleteSourceArchive: Boolean(
        plan?.hasSourceArchive &&
          deleteSourceArchive &&
          (!plan.hasDownloadFolder || deleteDownloadFolder)
      ),
      deleteWinePrefix: Boolean(
        plan?.isolatedWinePrefixPath && deleteWinePrefix
      ),
      removeFromLibrary,
    });
  };

  return (
    <Modal
      visible={visible}
      title={t("uninstall_modal_title", { game: plan?.title ?? gameTitle })}
      description={t("uninstall_modal_description")}
      onClose={handleClose}
      clickOutsideToClose={!loading}
    >
      <div className="uninstall-game-modal__content">
        {inspecting && (
          <p className="uninstall-game-modal__loading">
            {t("uninstall_inspecting")}
          </p>
        )}

        {inspectError && !inspecting && (
          <div className="uninstall-game-modal__warning uninstall-game-modal__warning--danger">
            {t("uninstall_inspect_failed")}
          </div>
        )}

        {plan?.activityBlock && !inspecting && (
          <div className="uninstall-game-modal__warning uninstall-game-modal__warning--danger">
            {t(getBlockDescriptionKey(plan.activityBlock), {
              details: plan.activityBlock.details ?? "",
            })}
          </div>
        )}

        {plan && !inspecting && !plan.activityBlock && (
          <>
            {plan.gameRoot && (
              <div className="uninstall-game-modal__target-box">
                <div className="uninstall-game-modal__target-header">
                  <span>{t("uninstall_game_folder_label")}</span>
                  {plan.gameRootSizeInBytes != null && (
                    <span>{formatBytes(plan.gameRootSizeInBytes)}</span>
                  )}
                </div>
                <code className="uninstall-game-modal__path">
                  {plan.gameRoot}
                </code>
              </div>
            )}

            {plan.gameRootBlock && (
              <div className="uninstall-game-modal__warning">
                {t(getBlockDescriptionKey(plan.gameRootBlock), {
                  details: plan.gameRootBlock.details ?? "",
                })}
              </div>
            )}

            {plan.nativeUninstaller && plan.canDeleteGameRoot && (
              <div className="uninstall-game-modal__methods">
                <RadioField
                  name="uninstall-method"
                  checked={mode === "native-uninstaller"}
                  onChange={() => setMode("native-uninstaller")}
                  label={t("uninstall_method_native", {
                    label: plan.nativeUninstaller.label,
                  })}
                />
                <RadioField
                  name="uninstall-method"
                  checked={mode === "folder-delete"}
                  onChange={() => setMode("folder-delete")}
                  label={t("uninstall_method_folder_delete")}
                />
              </div>
            )}

            {plan.nativeUninstaller && !plan.canDeleteGameRoot && (
              <p className="uninstall-game-modal__notice">
                {t("uninstall_native_only_notice", {
                  label: plan.nativeUninstaller.label,
                })}
              </p>
            )}

            <div className="uninstall-game-modal__options">
              {plan.hasDownloadFolder && plan.downloadFolderPath && (
                <CheckboxField
                  label={t("uninstall_delete_download_folder", {
                    path: plan.downloadFolderPath,
                    size:
                      plan.downloadFolderSizeInBytes != null
                        ? ` (${formatBytes(plan.downloadFolderSizeInBytes)})`
                        : "",
                  })}
                  checked={deleteDownloadFolder}
                  onChange={(event) =>
                    setDeleteDownloadFolder(event.target.checked)
                  }
                />
              )}

              {plan.hasSourceArchive &&
                (!plan.hasDownloadFolder || deleteDownloadFolder) && (
                <CheckboxField
                  label={t("delete_source_archive", { ns: "downloads" })}
                  checked={deleteSourceArchive}
                  onChange={(event) =>
                    setDeleteSourceArchive(event.target.checked)
                  }
                />
              )}

              {plan.isolatedWinePrefixPath && (
                <CheckboxField
                  label={t("uninstall_delete_wine_prefix", {
                    path: plan.isolatedWinePrefixPath,
                  })}
                  checked={deleteWinePrefix}
                  onChange={(event) =>
                    setDeleteWinePrefix(event.target.checked)
                  }
                />
              )}

              {hasAnyExecutableAction && (
                <CheckboxField
                  label={t("uninstall_also_remove_from_library")}
                  checked={removeFromLibrary}
                  onChange={(event) =>
                    setRemoveFromLibrary(event.target.checked)
                  }
                />
              )}
            </div>
          </>
        )}

        <div className="uninstall-game-modal__actions">
          <Button theme="outline" disabled={loading} onClick={handleClose}>
            {t("cancel")}
          </Button>
          <Button
            theme="danger"
            disabled={!canConfirm}
            onClick={handleConfirm}
          >
            {mode === "native-uninstaller" && plan?.nativeUninstaller
              ? t("uninstall_run_uninstaller")
              : t("uninstall_confirm")}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
