import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type {
  ExecuteGameUninstallOptions,
  ExecuteGameUninstallResult,
  GameShop,
  GameUninstallPlan,
  GameUninstallSafetyBlockReason,
} from "@types";
import { useLibrary } from "./use-library";
import { useToast } from "./use-toast";

export interface GameUninstallTarget {
  shop: GameShop;
  objectId: string;
}

interface UseGameUninstallOptions {
  onSuccess?: (result: ExecuteGameUninstallResult) => void;
}

const BLOCK_REASON_KEYS: Record<GameUninstallSafetyBlockReason, string> = {
  "game-running": "uninstall_blocked_running",
  downloading: "remove_files_downloading",
  transferring: "uninstall_blocked_transferring",
  "installer-running": "uninstall_blocked_installer_running",
  "unsafe-path": "uninstall_blocked_unsafe_path",
  "shared-with-other-game": "uninstall_blocked_shared_path",
  "symlink-target": "uninstall_blocked_symlink",
  "missing-files": "uninstall_blocked_missing_files",
};

export function useGameUninstall(
  target: GameUninstallTarget | null | undefined,
  enabled: boolean,
  options: UseGameUninstallOptions = {}
) {
  const { t } = useTranslation("game_details");
  const { updateLibrary } = useLibrary();
  const { showSuccessToast, showErrorToast } = useToast();

  const [plan, setPlan] = useState<GameUninstallPlan | null>(null);
  const [isInspecting, setIsInspecting] = useState(false);
  const [isUninstalling, setIsUninstalling] = useState(false);
  const [inspectError, setInspectError] = useState(false);

  const onSuccessRef = useRef(options.onSuccess);
  onSuccessRef.current = options.onSuccess;

  const uninstallAvailable =
    typeof globalThis.window?.electron?.inspectGameUninstall === "function" &&
    typeof globalThis.window?.electron?.uninstallGame === "function";

  const shop = target?.shop;
  const objectId = target?.objectId;

  useEffect(() => {
    setPlan(null);
    setInspectError(false);

    if (!enabled || !shop || !objectId || !uninstallAvailable) {
      setIsInspecting(false);
      return;
    }

    let cancelled = false;
    setIsInspecting(true);

    void globalThis.window.electron
      .inspectGameUninstall?.(shop, objectId)
      .then((nextPlan) => {
        if (!cancelled) setPlan(nextPlan ?? null);
      })
      .catch(() => {
        if (!cancelled) setInspectError(true);
      })
      .finally(() => {
        if (!cancelled) setIsInspecting(false);
      });

    return () => {
      cancelled = true;
    };
  }, [enabled, shop, objectId, uninstallAvailable]);

  const executeUninstall = useCallback(
    async (uninstallOptions: ExecuteGameUninstallOptions) => {
      if (!shop || !objectId || !uninstallAvailable) return;

      setIsUninstalling(true);
      try {
        const result = await globalThis.window.electron.uninstallGame?.(
          shop,
          objectId,
          uninstallOptions
        );

        if (!result) {
          showErrorToast(t("uninstall_failed"));
          return;
        }

        if (result.status === "blocked") {
          const reasonKey = result.blockReason
            ? BLOCK_REASON_KEYS[result.blockReason]
            : "uninstall_failed";
          showErrorToast(t(reasonKey, { details: result.message ?? "" }));
          return;
        }

        if (result.status === "cancelled-by-user") {
          showErrorToast(t("uninstall_cancelled"));
          return;
        }

        if (result.status === "uninstaller-launched") {
          showSuccessToast(
            t("uninstaller_launched_title"),
            t("uninstaller_launched_description")
          );
          onSuccessRef.current?.(result);
          return;
        }

        await updateLibrary();
        showSuccessToast(t("uninstall_success"));
        try {
          window.dispatchEvent(
            new CustomEvent("hydra:game-files-removed", {
              detail: { shop, objectId },
            })
          );
        } catch {
          /* empty */
        }
        onSuccessRef.current?.(result);
      } catch {
        showErrorToast(t("uninstall_failed"));
      } finally {
        setIsUninstalling(false);
      }
    },
    [
      shop,
      objectId,
      uninstallAvailable,
      updateLibrary,
      showSuccessToast,
      showErrorToast,
      t,
    ]
  );

  return {
    uninstallAvailable,
    plan,
    isInspecting,
    isUninstalling,
    inspectError,
    executeUninstall,
  };
}
