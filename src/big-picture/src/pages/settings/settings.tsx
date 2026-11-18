import {
  SettingsDraftProvider,
  useSettingsDraft,
  type SettingsSaveActionsProps,
} from "@renderer/context/settings/settings-draft.context";
import { AnimatePresence, motion } from "framer-motion";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocation } from "react-router-dom";
import {
  HIDE_COMMUNITY_SCREENSHOTS_SETTING_ID,
  isClassicsEnabled,
} from "@shared";

import {
  BumperBadge,
  Button,
  HorizontalFocusGroup,
  Modal,
  Tabs,
  type TabsItem,
  VerticalFocusGroup,
} from "../../components";
import {
  Feature,
  useFeature,
  useGamepad,
  useNavigation,
  useUserPreferences,
} from "../../hooks";
import { IS_DESKTOP } from "../../constants";
import {
  NavigationAudioService,
  type FocusOverrideTarget,
} from "../../services";
import { GamepadButtonType } from "../../types";
import { useVirtualKeyboardStore } from "../../stores";
import { AccountPrivacySettingsSection } from "./account-privacy";
import { AdvancedSettingsSection } from "./advanced";
import { BigPictureSettingsSection } from "./big-picture";
import { CompatibilitySettingsSection } from "./compatibility";
import { ContentSettingsSection } from "./content";
import { DownloadsSettingsSection } from "./downloads";
import { EmulationSettingsSection } from "./emulation";
import {
  isRetroArchEmulationDeepLink,
  getEmulatorDetailDeepLinkSystem,
} from "./emulation/navigation";
import { GeneralSettingsSection } from "./general";
import { IntegrationsSettingsSection } from "./integrations";
import { SETTINGS_PAGE_REGION_ID } from "./navigation";
import { NotificationsSettingsSection } from "./notifications";
import { SaveBackupsSettingsSection } from "./save-backups";
import { ScreenshotsSettingsSection } from "./screenshots";
import { SCREENSHOT_SETTINGS_FOCUS_IDS } from "./screenshots-section";
import { useUserDetails } from "../../hooks";
import {
  ACCOUNT_PRIVACY_PRIVACY_SELECT_ID,
  ADVANCED_GATE_CHECKBOX_ID,
  COMPATIBILITY_COMMON_REDIST_BUTTON_ID,
  COMPATIBILITY_PROTON_OPTION_AUTO_FOCUS_ID,
  CONTENT_ITEM_FOCUS_IDS,
  BIG_PICTURE_ITEM_FOCUS_IDS,
  DOWNLOADS_BEHAVIOR_ITEM_FOCUS_IDS,
  DOWNLOADS_SOURCES_SECTION_REGION_ID,
  DOWNLOAD_DIRECTORIES_DEFAULT_SELECT_ID,
  EMULATION_OVERVIEW_CARD_FOCUS_IDS,
  getIntegrationProviderCheckboxFocusId,
  NOTIFICATIONS_LIBRARY_ITEM_FOCUS_IDS,
  SAVE_BACKUPS_PRIMARY_BUTTON_ID,
} from "./settings-navigation";

import "./page.scss";

const ALL_SETTINGS_TABS = [
  { id: "general", label: "General" },
  { id: "local_backups", label: "Save Backups" },
  { id: "downloads", label: "Downloads" },
  { id: "notifications", label: "Notifications" },
  { id: "content", label: "Content" },
  { id: "screenshots", label: "Screenshots" },
  { id: "big-picture", label: "Big Picture" },
  { id: "emulation", label: "Emulation" },
  { id: "integrations", label: "Integrations" },
  { id: "compatibility", label: "Compatibility" },
  { id: "account-privacy", label: "Account and Privacy" },
  { id: "advanced", label: "Advanced" },
] as const;

const SETTINGS_PAGE_FADE_TRANSITION = {
  duration: 0.24,
  ease: "easeOut",
} as const;

const SETTINGS_TAB_FADE_TRANSITION = {
  duration: 0.18,
  ease: "easeOut",
} as const;

type SettingsTabId = (typeof ALL_SETTINGS_TABS)[number]["id"];
type SettingsSectionId =
  | "sources"
  | typeof HIDE_COMMUNITY_SCREENSHOTS_SETTING_ID;
type SettingsSectionComponentProps = {
  className?: string;
};

function getSettingsTabFromSearch(search: string): SettingsTabId | null {
  const tab = new URLSearchParams(search).get("tab");

  return ALL_SETTINGS_TABS.some((item) => item.id === tab)
    ? (tab as SettingsTabId)
    : null;
}

function getSettingsSectionFromSearch(
  search: string
): SettingsSectionId | null {
  const section = new URLSearchParams(search).get("section");

  return section === "sources" ||
    section === HIDE_COMMUNITY_SCREENSHOTS_SETTING_ID
    ? section
    : null;
}

const SETTINGS_TAB_CONTENT: Record<
  SettingsTabId,
  (props: SettingsSectionComponentProps) => React.JSX.Element | null
> = {
  general: GeneralSettingsSection,
  local_backups: SaveBackupsSettingsSection,
  downloads: DownloadsSettingsSection,
  notifications: NotificationsSettingsSection,
  content: ContentSettingsSection,
  screenshots: ScreenshotsSettingsSection,
  "big-picture": BigPictureSettingsSection,
  emulation: EmulationSettingsSection,
  integrations: IntegrationsSettingsSection,
  compatibility: CompatibilitySettingsSection,
  "account-privacy": AccountPrivacySettingsSection,
  advanced: AdvancedSettingsSection,
};

function SettingsTabPanel({
  selectedTab,
  initialFocusTarget,
  children,
}: Readonly<{
  selectedTab: SettingsTabId;
  initialFocusTarget: FocusOverrideTarget | null;
  children: React.JSX.Element;
}>) {
  const { setFocus, setFocusRegion } = useNavigation();

  useEffect(() => {
    if (!initialFocusTarget) return;

    const frameId = globalThis.window.requestAnimationFrame(() => {
      if (initialFocusTarget.type === "item") {
        setFocus(initialFocusTarget.itemId);
        return;
      }

      if (initialFocusTarget.type === "region") {
        setFocusRegion(
          initialFocusTarget.regionId,
          initialFocusTarget.entryDirection,
          {
            initialFocusId: initialFocusTarget.initialFocusId,
            preferRememberedFocus: initialFocusTarget.preferRememberedFocus,
          }
        );
      }
    });

    return () => {
      globalThis.window.cancelAnimationFrame(frameId);
    };
  }, [initialFocusTarget, setFocus, setFocusRegion]);

  return (
    <motion.div
      key={selectedTab}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={SETTINGS_TAB_FADE_TRANSITION}
    >
      {children}
    </motion.div>
  );
}

type SettingsConfirmRequest = {
  kind: "save" | "discard";
  changes: string[];
  resolve: (accepted: boolean) => void;
};

const SETTINGS_REVIEW_CANCEL_BUTTON_ID = "settings-review-cancel-button";
const SETTINGS_REVIEW_CONFIRM_BUTTON_ID = "settings-review-confirm-button";

export default function Settings() {
  const [confirmRequest, setConfirmRequest] =
    useState<SettingsConfirmRequest | null>(null);
  const confirmRequestRef = useRef<SettingsConfirmRequest | null>(null);

  const requestConfirmation = useCallback(
    (kind: "save" | "discard", changes: string[]) =>
      new Promise<boolean>((resolve) => {
        if (confirmRequestRef.current) {
          resolve(false);
          return;
        }
        const pending = { kind, changes, resolve };
        confirmRequestRef.current = pending;
        setConfirmRequest(pending);
      }),
    []
  );

  const settleConfirmation = useCallback((accepted: boolean) => {
    const pending = confirmRequestRef.current;
    confirmRequestRef.current = null;
    setConfirmRequest(null);
    pending?.resolve(accepted);
  }, []);

  useEffect(
    () => () => {
      if (confirmRequestRef.current) {
        confirmRequestRef.current.resolve(false);
        confirmRequestRef.current = null;
      }
    },
    []
  );

  const isConfirmOpen = confirmRequest !== null;

  return (
    <SettingsDraftProvider
      confirmationOverride={requestConfirmation}
      renderActions={(actions) => (
        <SaveActions {...actions} modalOpen={isConfirmOpen} />
      )}
    >
      <SettingsContent />
      <SettingsReviewModal
        request={confirmRequest}
        onSettle={settleConfirmation}
      />
    </SettingsDraftProvider>
  );
}

function SettingsReviewModal({
  request,
  onSettle,
}: Readonly<{
  request: SettingsConfirmRequest | null;
  onSettle: (accepted: boolean) => void;
}>) {
  const { setFocus } = useNavigation();
  const visible = request !== null;

  useEffect(() => {
    if (!visible) return;
    const frameId = globalThis.window.requestAnimationFrame(() => {
      setFocus(SETTINGS_REVIEW_CANCEL_BUTTON_ID);
    });
    return () => globalThis.window.cancelAnimationFrame(frameId);
  }, [setFocus, visible]);

  const isSave = request?.kind === "save";

  return (
    <Modal
      visible={visible}
      onClose={() => onSettle(false)}
      title={isSave ? "Review settings changes" : "Unsaved settings"}
      description={
        isSave ? "Save these changes?" : "Discard unsaved edits and continue?"
      }
      initialFocusId={SETTINGS_REVIEW_CANCEL_BUTTON_ID}
      className="settings-review-modal"
      backdropClassName="settings-review-modal-backdrop"
    >
      <VerticalFocusGroup
        regionId="settings-review-modal-content"
        className="settings-review-modal__content"
      >
        {request && request.changes.length > 0 && (
          <ul className="settings-review-modal__list">
            {request.changes.map((change, index) => (
              <li key={`${index}-${change}`}>{change}</li>
            ))}
          </ul>
        )}

        <HorizontalFocusGroup
          regionId="settings-review-modal-actions"
          className="settings-review-modal__actions"
        >
          <Button
            variant="secondary"
            focusId={SETTINGS_REVIEW_CANCEL_BUTTON_ID}
            onClick={() => onSettle(false)}
          >
            Keep editing
          </Button>
          <Button
            variant={isSave ? "primary" : "danger"}
            focusId={SETTINGS_REVIEW_CONFIRM_BUTTON_ID}
            onClick={() => onSettle(true)}
          >
            {isSave ? "Save changes" : "Discard edits"}
          </Button>
        </HorizontalFocusGroup>
      </VerticalFocusGroup>
    </Modal>
  );
}

function SaveActions({
  dirty,
  canSave,
  busy,
  save,
  discard,
  modalOpen,
}: SettingsSaveActionsProps & { modalOpen: boolean }) {
  const { onButtonPressed, isActiveGamepadEvent } = useGamepad();
  const keyboardTarget = useVirtualKeyboardStore((state) => state.target);
  useEffect(
    () =>
      onButtonPressed(GamepadButtonType.START, (event) => {
        if (
          isActiveGamepadEvent(event) &&
          !keyboardTarget &&
          !modalOpen &&
          canSave &&
          !busy
        )
          save();
      }),
    [
      onButtonPressed,
      isActiveGamepadEvent,
      keyboardTarget,
      modalOpen,
      canSave,
      busy,
      save,
    ]
  );
  return (
    <HorizontalFocusGroup
      regionId="settings-save-actions"
      className="settings-save-bar__actions"
    >
      <Button
        variant="secondary"
        disabled={!dirty || busy}
        focusId="settings-discard"
        onClick={discard}
      >
        Discard edits
      </Button>
      <Button
        disabled={!canSave || busy}
        focusId="settings-save"
        onClick={save}
      >
        {busy ? "Please wait…" : "Save changes (Start)"}
      </Button>
    </HorizontalFocusGroup>
  );
}

function SettingsContent() {
  const draft = useSettingsDraft();

  const { userDetails } = useUserDetails();
  const { search } = useLocation();
  const [selectedTab, setSelectedTab] = useState<SettingsTabId>(
    getSettingsTabFromSearch(search) ?? ALL_SETTINGS_TABS[0].id
  );
  const guardNavigation = draft?.guardNavigation;
  const selectTab = useCallback(
    (tab: SettingsTabId) => {
      if (tab !== selectedTab)
        void guardNavigation?.(() => setSelectedTab(tab));
    },
    [selectedTab, guardNavigation]
  );
  const { onButtonPressed, isActiveGamepadEvent } = useGamepad();
  const virtualKeyboardTarget = useVirtualKeyboardStore(
    (state) => state.target
  );
  const requestedSection = useMemo(
    () => getSettingsSectionFromSearch(search),
    [search]
  );

  const { isFeatureEnabled } = useFeature();
  const userPreferences = useUserPreferences();
  const classicsEnabled = isClassicsEnabled(userPreferences);
  const showScreenshotsTab =
    IS_DESKTOP && isFeatureEnabled(Feature.Screenshots);

  const visibleTabs = useMemo(() => {
    return ALL_SETTINGS_TABS.filter((tab) => {
      if (tab.id === "screenshots") return showScreenshotsTab;
      if (tab.id === "emulation") return classicsEnabled;
      if (tab.id !== "account-privacy") return true;

      return Boolean(userDetails);
    });
  }, [showScreenshotsTab, classicsEnabled, userDetails]);

  const selectedTabIndex = visibleTabs.findIndex(
    (tab) => tab.id === selectedTab
  );
  const SelectedTabContent =
    SETTINGS_TAB_CONTENT[selectedTab] ?? GeneralSettingsSection;

  useEffect(() => {
    const requestedTab = getSettingsTabFromSearch(search);
    if (requestedTab && visibleTabs.some((tab) => tab.id === requestedTab)) {
      setSelectedTab(requestedTab);
      return;
    }

    setSelectedTab((current) =>
      visibleTabs.some((tab) => tab.id === current)
        ? current
        : (visibleTabs[0]?.id ?? ALL_SETTINGS_TABS[0].id)
    );
  }, [search, visibleTabs]);

  const selectTabByIndex = useCallback(
    (nextIndex: number) => {
      const clampedIndex = Math.max(
        0,
        Math.min(nextIndex, visibleTabs.length - 1)
      );
      const nextTab = visibleTabs[clampedIndex];

      if (!nextTab || nextTab.id === selectedTab) return false;

      selectTab(nextTab.id);
      return true;
    },
    [selectTab, selectedTab, visibleTabs]
  );

  useEffect(() => {
    const removeLeftBumper = onButtonPressed(
      GamepadButtonType.LEFT_BUMPER,
      (event) => {
        if (
          virtualKeyboardTarget ||
          !isActiveGamepadEvent(event) ||
          selectedTabIndex <= 0
        ) {
          return;
        }

        if (selectTabByIndex(selectedTabIndex - 1)) {
          NavigationAudioService.getInstance().play("scroll");
        }
      }
    );

    const removeRightBumper = onButtonPressed(
      GamepadButtonType.RIGHT_BUMPER,
      (event) => {
        if (
          virtualKeyboardTarget ||
          !isActiveGamepadEvent(event) ||
          selectedTabIndex >= visibleTabs.length - 1
        ) {
          return;
        }

        if (selectTabByIndex(selectedTabIndex + 1)) {
          NavigationAudioService.getInstance().play("scroll");
        }
      }
    );

    return () => {
      removeLeftBumper();
      removeRightBumper();
    };
  }, [
    isActiveGamepadEvent,
    onButtonPressed,
    selectTabByIndex,
    selectedTabIndex,
    virtualKeyboardTarget,
    visibleTabs.length,
  ]);

  const tabItems = useMemo(() => {
    return visibleTabs.map(
      (tab): TabsItem<SettingsTabId> => ({
        value: tab.id,
        label: tab.label,
      })
    );
  }, [visibleTabs]);

  const initialFocusTarget = useMemo<FocusOverrideTarget | null>(() => {
    const platform = globalThis.window.electron.platform;

    switch (selectedTab) {
      case "general":
        return {
          type: "item",
          itemId: DOWNLOAD_DIRECTORIES_DEFAULT_SELECT_ID,
        };
      case "local_backups":
        return {
          type: "item",
          itemId: SAVE_BACKUPS_PRIMARY_BUTTON_ID,
        };
      case "downloads":
        return requestedSection === "sources"
          ? {
              type: "region",
              regionId: DOWNLOADS_SOURCES_SECTION_REGION_ID,
              entryDirection: "down",
              preferRememberedFocus: false,
            }
          : {
              type: "item",
              itemId:
                DOWNLOADS_BEHAVIOR_ITEM_FOCUS_IDS.seedAfterDownloadComplete,
            };
      case "notifications":
        return {
          type: "item",
          itemId:
            NOTIFICATIONS_LIBRARY_ITEM_FOCUS_IDS.downloadNotificationsEnabled,
        };
      case "content":
        return {
          type: "item",
          itemId: CONTENT_ITEM_FOCUS_IDS.autoplayGameTrailers,
        };
      case "screenshots":
        return {
          type: "item",
          itemId:
            requestedSection === HIDE_COMMUNITY_SCREENSHOTS_SETTING_ID
              ? SCREENSHOT_SETTINGS_FOCUS_IDS.hideCommunity
              : SCREENSHOT_SETTINGS_FOCUS_IDS.enabled,
        };
      case "big-picture":
        return {
          type: "item",
          itemId: BIG_PICTURE_ITEM_FOCUS_IDS.enableVirtualKeyboard,
        };
      case "emulation":
        return isRetroArchEmulationDeepLink(search) ||
          getEmulatorDetailDeepLinkSystem(search)
          ? null
          : {
              type: "item",
              itemId: EMULATION_OVERVIEW_CARD_FOCUS_IDS.ps1,
            };
      case "integrations":
        return {
          type: "item",
          itemId: getIntegrationProviderCheckboxFocusId("real-debrid"),
        };
      case "compatibility":
        return {
          type: "item",
          itemId:
            platform === "win32"
              ? COMPATIBILITY_COMMON_REDIST_BUTTON_ID
              : COMPATIBILITY_PROTON_OPTION_AUTO_FOCUS_ID,
        };
      case "account-privacy":
        return userDetails
          ? {
              type: "item",
              itemId: ACCOUNT_PRIVACY_PRIVACY_SELECT_ID,
            }
          : null;
      case "advanced":
        return {
          type: "item",
          itemId: ADVANCED_GATE_CHECKBOX_ID,
        };
      default:
        return null;
    }
  }, [requestedSection, search, selectedTab, userDetails]);

  return (
    <VerticalFocusGroup regionId={SETTINGS_PAGE_REGION_ID} asChild>
      <motion.section
        className="settings-page"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={SETTINGS_PAGE_FADE_TRANSITION}
      >
        <div className="settings-page__stack">
          <div className="settings-page__tabs-wrap">
            <Tabs
              className="settings-page__tabs"
              items={tabItems}
              value={selectedTab}
              onValueChange={selectTab}
              variant="settings"
              ariaLabel="Settings categories"
              beforeTabs={<BumperBadge label="LB" />}
              afterTabs={<BumperBadge label="RB" />}
            />
          </div>

          <section className="settings-page__content">
            <AnimatePresence mode="wait" initial={false}>
              <SettingsTabPanel
                selectedTab={selectedTab}
                initialFocusTarget={initialFocusTarget}
              >
                <SelectedTabContent
                  key={draft?.revision}
                  className="settings-page__copy"
                />
              </SettingsTabPanel>
            </AnimatePresence>
          </section>
        </div>
      </motion.section>
    </VerticalFocusGroup>
  );
}
