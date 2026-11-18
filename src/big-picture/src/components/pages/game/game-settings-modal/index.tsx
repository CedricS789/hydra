import localEdition from "../../../../../../shared/local-edition.json";
import { isDangerZoneTabVisible } from "@shared";
import type { LibraryGame } from "@types";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { SidebarModal, type SidebarModalTab } from "../../../common";
import { resolvePreferredGameAssets } from "../../../../helpers";
import { Feature, useFeature, useUserPreferences } from "../../../../hooks";
import { useUserDetails } from "../../../../hooks/use-user-details.hook";

import "./styles.scss";
import {
  GameCustomizationSettingsTab,
  type GameCustomizationSettingsProps,
  GAME_CUSTOMIZATION_SETTINGS_PRIMARY_CONTROL_ID,
} from "./customization-tab";
import {
  GameLaunchSettingsTab,
  type GameLaunchSettingsProps,
  GAME_LAUNCH_SETTINGS_PRIMARY_CONTROL_ID,
} from "./launch-tab";
import {
  GameCloudSettingsTab,
  type GameCloudSettingsProps,
  GAME_CLOUD_SETTINGS_PRIMARY_CONTROL_ID,
} from "./cloud-tab";
import {
  GameCloudV2SettingsTab,
  GAME_CLOUD_V2_SETTINGS_PRIMARY_CONTROL_ID,
} from "./cloud-v2-tab";
import {
  GameDownloadsSettingsTab,
  GAME_DOWNLOADS_SETTINGS_PRIMARY_CONTROL_ID,
} from "./downloads-tab";
import {
  GameDangerZoneSettingsTab,
  GAME_DANGER_ZONE_PRIMARY_CONTROL_ID,
} from "./danger-zone-tab";
import {
  GameCompatibilitySettingsTab,
  GAME_COMPATIBILITY_SETTINGS_PRIMARY_CONTROL_ID,
} from "./compatibility-tab";
import {
  GameLocalBackupsSettingsTab,
  GAME_LOCAL_BACKUPS_PRIMARY_CONTROL_ID,
} from "./local-backups-tab";
import {
  shouldShowCloudSaveV2Tab,
  shouldShowLegacyCloudSaveTab,
  shouldShowLocalBackupsTab,
} from "./cloud-tab-visibility";

export type GameSettingsTabId =
  | "launch"
  | "customization"
  | "local_backups"
  | "hydra_cloud"
  | "hydra_cloud_legacy"
  | "compatibility"
  | "downloads"
  | "danger_zone";

const GAME_SETTINGS_TAB_FOCUS_IDS: Record<GameSettingsTabId, string> = {
  launch: GAME_LAUNCH_SETTINGS_PRIMARY_CONTROL_ID,
  customization: GAME_CUSTOMIZATION_SETTINGS_PRIMARY_CONTROL_ID,
  local_backups: GAME_LOCAL_BACKUPS_PRIMARY_CONTROL_ID,
  hydra_cloud: GAME_CLOUD_V2_SETTINGS_PRIMARY_CONTROL_ID,
  hydra_cloud_legacy: GAME_CLOUD_SETTINGS_PRIMARY_CONTROL_ID,
  downloads: GAME_DOWNLOADS_SETTINGS_PRIMARY_CONTROL_ID,
  danger_zone: GAME_DANGER_ZONE_PRIMARY_CONTROL_ID,
  compatibility: GAME_COMPATIBILITY_SETTINGS_PRIMARY_CONTROL_ID,
};

interface GameSettingsModalProps {
  visible: boolean;
  game: LibraryGame;
  removeFilesGame?: LibraryGame;
  initialTab?: GameSettingsTabId;
  launchSettings: GameLaunchSettingsProps;
  customizationSettings: GameCustomizationSettingsProps;
  cloudSettings: GameCloudSettingsProps;
  onClose: () => void;
}

export function GameSettingsModal({
  visible,
  game,
  removeFilesGame,
  initialTab = "launch",
  launchSettings,
  customizationSettings,
  cloudSettings,
  onClose,
}: Readonly<GameSettingsModalProps>) {
  const { t } = useTranslation(["game_details", "header", "ludusavi"]);
  const [activeTabId, setActiveTabId] = useState<GameSettingsTabId>(initialTab);
  const { userDetails, hasActiveSubscription } = useUserDetails();
  const userPreferences = useUserPreferences();
  const { isFeatureEnabled } = useFeature();
  const preferredAssets = useMemo(
    () => resolvePreferredGameAssets(game, null),
    [game]
  );
  const isDev = import.meta.env.DEV;
  const shouldShowCompatibilityTab =
    globalThis.window.electron.platform === "linux" || isDev;
  const shouldShowDownloadsTab = game.shop !== "custom";
  const shouldShowDangerZoneTab = isDangerZoneTabVisible(userPreferences, {
    isCustomGame: game.shop === "custom",
    screenshotsFeatureEnabled: isFeatureEnabled(Feature.Screenshots),
    includePlaytimeActions: false,
  });
  const settingsLabel = t("settings", { ns: "header" });

  useEffect(() => {
    if (visible) {
      setActiveTabId(initialTab);
    }
  }, [initialTab, visible]);

  const launchContent = useMemo(
    () => <GameLaunchSettingsTab {...launchSettings} />,
    [launchSettings]
  );
  const customizationContent = useMemo(
    () => <GameCustomizationSettingsTab {...customizationSettings} />,
    [customizationSettings]
  );
  const cloudContent = useMemo(
    () => <GameCloudSettingsTab {...cloudSettings} />,
    [cloudSettings]
  );
  const handleSelectExecutableFromSaveTab = useCallback(() => {
    setActiveTabId("launch");
  }, []);
  const cloudV2Content = useMemo(
    () => (
      <GameCloudV2SettingsTab
        onSelectExecutable={handleSelectExecutableFromSaveTab}
      />
    ),
    [handleSelectExecutableFromSaveTab]
  );
  const localBackupsContent = useMemo(
    () => (
      <GameLocalBackupsSettingsTab
        game={game}
        onSelectExecutable={handleSelectExecutableFromSaveTab}
        onCloseModal={onClose}
      />
    ),
    [game, handleSelectExecutableFromSaveTab, onClose]
  );
  const downloadContent = useMemo(
    () => <GameDownloadsSettingsTab game={game} />,
    [game]
  );
  const dangerContent = useMemo(
    () => (
      <GameDangerZoneSettingsTab
        game={game}
        removeFilesGame={removeFilesGame}
        onClose={onClose}
      />
    ),
    [game, removeFilesGame, onClose]
  );
  const compatibilityContent = useMemo(
    () => <GameCompatibilitySettingsTab game={game} />,
    [game]
  );

  const isSignedIn = userDetails !== null;
  const shouldShowLocalBackups = shouldShowLocalBackupsTab(
    localEdition.hideCloudPromotions,
    game.isDeleted
  );
  const shouldShowCloudV2Tab = shouldShowCloudSaveV2Tab(
    game.shop,
    isSignedIn,
    hasActiveSubscription,
    game.platform,
    localEdition.hideCloudPromotions
  );
  const shouldShowLegacyCloudTab = shouldShowLegacyCloudSaveTab(
    game.shop,
    isSignedIn,
    hasActiveSubscription,
    game.platform,
    localEdition.hideCloudPromotions
  );

  useEffect(() => {
    const isUnavailableTab =
      (activeTabId === "local_backups" && !shouldShowLocalBackups) ||
      (activeTabId === "hydra_cloud" && !shouldShowCloudV2Tab) ||
      (activeTabId === "hydra_cloud_legacy" && !shouldShowLegacyCloudTab) ||
      (activeTabId === "downloads" && !shouldShowDownloadsTab) ||
      (activeTabId === "danger_zone" && !shouldShowDangerZoneTab);

    if (isUnavailableTab) {
      setActiveTabId("launch");
    }
  }, [
    activeTabId,
    shouldShowLocalBackups,
    shouldShowCloudV2Tab,
    shouldShowLegacyCloudTab,
    shouldShowDownloadsTab,
    shouldShowDangerZoneTab,
  ]);

  const tabs = useMemo<SidebarModalTab<GameSettingsTabId>[]>(
    () => [
      {
        id: "launch",
        label: t("settings_category_launch"),
        content: launchContent,
      },
      {
        id: "customization",
        label: t("settings_category_customization"),
        content: customizationContent,
      },
      ...(shouldShowLocalBackups
        ? [
            {
              id: "local_backups",
              label: t("title", { ns: "ludusavi" }),
              content: localBackupsContent,
            } satisfies SidebarModalTab<GameSettingsTabId>,
          ]
        : []),
      ...(shouldShowCloudV2Tab
        ? [
            {
              id: "hydra_cloud",
              label: t("settings_category_hydra_cloud"),
              content: cloudV2Content,
            } satisfies SidebarModalTab<GameSettingsTabId>,
          ]
        : []),
      ...(shouldShowLegacyCloudTab
        ? [
            {
              id: "hydra_cloud_legacy",
              label: t(
                shouldShowCloudV2Tab
                  ? "settings_category_legacy_saves"
                  : "settings_category_hydra_cloud"
              ),
              content: cloudContent,
            } satisfies SidebarModalTab<GameSettingsTabId>,
          ]
        : []),
      ...(shouldShowCompatibilityTab
        ? [
            {
              id: "compatibility",
              label: t("settings_category_compatibility"),
              content: compatibilityContent,
            } satisfies SidebarModalTab<GameSettingsTabId>,
          ]
        : []),
      ...(shouldShowDownloadsTab
        ? [
            {
              id: "downloads",
              label: t("settings_category_downloads"),
              content: downloadContent,
            } satisfies SidebarModalTab<GameSettingsTabId>,
          ]
        : []),
      ...(shouldShowDangerZoneTab
        ? [
            {
              id: "danger_zone",
              label: t("settings_category_danger_zone"),
              content: dangerContent,
            } satisfies SidebarModalTab<GameSettingsTabId>,
          ]
        : []),
    ],
    [
      cloudContent,
      cloudV2Content,
      compatibilityContent,
      customizationContent,
      dangerContent,
      downloadContent,
      launchContent,
      localBackupsContent,
      shouldShowCloudV2Tab,
      shouldShowLegacyCloudTab,
      shouldShowLocalBackups,
      shouldShowCompatibilityTab,
      shouldShowDownloadsTab,
      shouldShowDangerZoneTab,
      t,
    ]
  );

  return (
    <SidebarModal
      visible={visible}
      onClose={onClose}
      title={settingsLabel}
      coverImage={preferredAssets.heroSrc || undefined}
      className="game-settings-modal"
      ariaLabel={settingsLabel}
      contentEntryFocusId={GAME_SETTINGS_TAB_FOCUS_IDS[activeTabId]}
      tabs={tabs}
      activeTabId={activeTabId}
      onActiveTabChange={setActiveTabId}
    />
  );
}
