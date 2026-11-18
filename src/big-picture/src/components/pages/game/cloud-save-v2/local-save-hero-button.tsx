import { LocalSaveStatusIcon } from "@renderer/pages/game-details/cloud-save-v2/local-save-status-icon";
import { getLocalSavePresentation } from "@renderer/pages/game-details/cloud-save-v2/local-save-presentation";
import type { LibraryGame } from "@types";
import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { useDate, useLudusaviLocalState } from "../../../../hooks";
import type { FocusOverrides } from "../../../../services";
import { Button } from "../../../common";
import { GAME_HERO_OPEN_CLOUD_SAVE_ID } from "../navigation";

interface BigPictureLocalSaveHeroButtonProps {
  game: LibraryGame;
  focusId?: string;
  focusNavigationOverrides: FocusOverrides;
  onClick: () => void;
}

export function BigPictureLocalSaveHeroButton({
  game,
  focusId = GAME_HERO_OPEN_CLOUD_SAVE_ID,
  focusNavigationOverrides,
  onClick,
}: Readonly<BigPictureLocalSaveHeroButtonProps>) {
  const { t } = useTranslation("ludusavi");
  const { formatDistance } = useDate();
  const { state } = useLudusaviLocalState();

  const gameKey = `${game.shop}:${game.objectId}`;
  const gameSettings = state?.settings.games[gameKey];
  const summary = state?.gameSummaries?.[gameKey];
  const hasExecutablePath = Boolean(
    game.executablePath || gameSettings?.trackingPaths?.length
  );

  const presentation = useMemo(
    () =>
      getLocalSavePresentation({
        globalEnabled: state?.settings.enabled ?? true,
        gameEnabled: gameSettings?.enabled !== false,
        hasExecutablePath,
        isBackingUp: state?.activeGameKey === gameKey,
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
            { addSuffix: true }
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

  return (
    <Button
      focusId={focusId}
      focusNavigationOverrides={focusNavigationOverrides}
      variant="secondary"
      icon={<LocalSaveStatusIcon icon={presentation.icon} size={22} />}
      onClick={onClick}
    >
      {label}
    </Button>
  );
}
