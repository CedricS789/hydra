import type { LibraryGame } from "@types";
import { hasCloudSaveExecutableSelection } from "@shared";
import { GameSettingsModal, type GameSettingsTabId } from "../game";
import { BigPictureCloudSaveProvider } from "../game/cloud-save-v2";
import { useGameSettingsModalState } from "../game/game-settings-modal/use-game-settings-modal-state";
import { useGameDetails } from "../../../hooks";

interface LibraryGameSettingsModalProps {
  visible: boolean;
  game: LibraryGame | null;
  initialTab?: GameSettingsTabId;
  onClose: () => void;
}

export function LibraryGameSettingsModal({
  visible,
  game,
  initialTab = "launch",
  onClose,
}: Readonly<LibraryGameSettingsModalProps>) {
  const objectId = game?.objectId ?? "";
  const shop = game?.shop ?? "steam";
  const {
    game: detailedGame,
    presentationGame,
    isGameRunning,
    updateGame,
    refreshGameDetails,
  } = useGameDetails(objectId, shop);
  const modalGame = detailedGame ?? game;
  const { launchSettings, customizationSettings, cloudSettings } =
    useGameSettingsModalState({
      game: modalGame,
      visible,
      updateGame,
      refreshGameDetails,
    });

  if (
    !visible ||
    !modalGame ||
    !launchSettings ||
    !customizationSettings ||
    !cloudSettings
  ) {
    return null;
  }

  return (
    <BigPictureCloudSaveProvider
      objectId={modalGame.objectId}
      shop={modalGame.shop}
      platform={modalGame.platform}
      hasExecutablePath={hasCloudSaveExecutableSelection(modalGame)}
      isGameRunning={isGameRunning}
      enableGamePageSync={false}
      onSelectExecutable={() => undefined}
    >
      <GameSettingsModal
        visible={visible}
        game={modalGame}
        removeFilesGame={presentationGame ?? modalGame}
        initialTab={initialTab}
        launchSettings={launchSettings}
        customizationSettings={customizationSettings}
        cloudSettings={cloudSettings}
        onClose={onClose}
      />
    </BigPictureCloudSaveProvider>
  );
}
