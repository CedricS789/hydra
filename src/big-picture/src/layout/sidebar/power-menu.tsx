import { useRef, useState } from "react";
import {
  ArrowClockwiseIcon,
  CaretRightIcon,
  MoonIcon,
  PowerIcon,
  SignOutIcon,
  XCircleIcon,
} from "@phosphor-icons/react";
import type { SystemPowerAction } from "@types";
import { FocusItem, Modal, VerticalFocusGroup } from "../../components/common";
import { ConfirmationModal } from "../../components/modals";
import { IS_DESKTOP } from "../../constants";
import { useBigPictureToast } from "../../hooks";
import "./power-menu.scss";

type ConfirmedPowerAction = "quit-app" | SystemPowerAction;

interface ConfirmedPowerOption {
  action: ConfirmedPowerAction;
  focusId: string;
  label: string;
  subtitle: string;
  title: string;
  description: string;
  icon: typeof PowerIcon;
  scope: "app" | "system";
  optionDanger?: boolean;
  confirmDanger?: boolean;
  errorTitle: string;
  errorMessage: string;
}

const CONFIRMED_POWER_OPTIONS: readonly ConfirmedPowerOption[] = [
  {
    action: "quit-app",
    focusId: "big-picture-power-quit",
    label: "Quit Hydra",
    subtitle: "Close the application",
    title: "Quit Hydra?",
    description:
      "Hydra will close. Active downloads and background services will stop.",
    icon: XCircleIcon,
    scope: "app",
    errorTitle: "Could not quit Hydra",
    errorMessage: "Please try again or close Hydra from the system tray.",
  },
  {
    action: "suspend",
    focusId: "big-picture-power-suspend",
    label: "Suspend",
    subtitle: "Put the system to sleep",
    title: "Suspend the system?",
    description:
      "The system will sleep. Downloads will pause until it wakes up.",
    icon: MoonIcon,
    scope: "system",
    errorTitle: "Could not change the system power state",
    errorMessage:
      "The system may have blocked the request or require additional permissions.",
  },
  {
    action: "restart",
    focusId: "big-picture-power-restart",
    label: "Restart",
    subtitle: "Restart your device",
    title: "Restart the system?",
    description:
      "The system will restart. Save your game and any open work before continuing.",
    icon: ArrowClockwiseIcon,
    scope: "system",
    confirmDanger: true,
    errorTitle: "Could not change the system power state",
    errorMessage:
      "The system may have blocked the request or require additional permissions.",
  },
  {
    action: "power-off",
    focusId: "big-picture-power-power-off",
    label: "Power Off",
    subtitle: "Shut down your device",
    title: "Power off the system?",
    description:
      "The system will shut down. Save your game and any open work before continuing.",
    icon: PowerIcon,
    scope: "system",
    optionDanger: true,
    confirmDanger: true,
    errorTitle: "Could not change the system power state",
    errorMessage:
      "The system may have blocked the request or require additional permissions.",
  },
];

interface PowerMenuProps {
  visible: boolean;
  onClose: () => void;
  onExitBigPicture: () => void;
}

export function PowerMenu({
  visible,
  onClose,
  onExitBigPicture,
}: Readonly<PowerMenuProps>) {
  const [selectedAction, setSelectedAction] =
    useState<ConfirmedPowerAction | null>(null);
  const [loading, setLoading] = useState(false);
  const pendingRef = useRef(false);
  const { showErrorToast } = useBigPictureToast();
  const selectedOption = CONFIRMED_POWER_OPTIONS.find(
    (option) => option.action === selectedAction
  );
  const canControlSystem =
    IS_DESKTOP &&
    ["win32", "linux", "darwin"].includes(globalThis.window.electron.platform);

  const isOptionEnabled = (option: ConfirmedPowerOption) =>
    option.scope === "app" ? IS_DESKTOP : canControlSystem;

  const closeConfirmation = () => {
    if (!pendingRef.current) setSelectedAction(null);
  };

  const confirmAction = async () => {
    if (
      !selectedOption ||
      !isOptionEnabled(selectedOption) ||
      pendingRef.current
    )
      return;

    pendingRef.current = true;
    setLoading(true);
    try {
      if (selectedOption.action === "quit-app") {
        await globalThis.window.electron.quitApp();
      } else {
        await globalThis.window.electron.executeSystemPowerAction(
          selectedOption.action
        );
      }
      setSelectedAction(null);
      onClose();
    } catch {
      setSelectedAction(null);
      showErrorToast(selectedOption.errorTitle, {
        message: selectedOption.errorMessage,
      });
    } finally {
      pendingRef.current = false;
      setLoading(false);
    }
  };

  return (
    <>
      <Modal
        visible={visible}
        onClose={() => {
          if (selectedAction || pendingRef.current) return;
          onClose();
        }}
        title="Power"
        description="Choose what to do with Hydra or your system."
        initialFocusId="big-picture-power-exit"
        className="power-menu"
        backdropClassName="power-menu-backdrop"
        closeOnBackdrop={false}
      >
        <VerticalFocusGroup
          regionId="big-picture-power-options"
          className="power-menu__options"
          style={{ gap: 4 }}
        >
          <PowerMenuOption
            focusId="big-picture-power-exit"
            label="Exit Big Picture"
            subtitle="Return to desktop mode"
            icon={SignOutIcon}
            onClick={() => {
              onClose();
              onExitBigPicture();
            }}
          />
          {CONFIRMED_POWER_OPTIONS.map((option) => (
            <PowerMenuOption
              key={option.action}
              focusId={option.focusId}
              label={option.label}
              subtitle={option.subtitle}
              icon={option.icon}
              danger={option.optionDanger}
              disabled={!isOptionEnabled(option)}
              onClick={() => setSelectedAction(option.action)}
            />
          ))}
        </VerticalFocusGroup>
      </Modal>
      {selectedOption && (
        <ConfirmationModal
          visible={visible}
          title={selectedOption.title}
          description={selectedOption.description}
          confirmLabel={selectedOption.label}
          onClose={closeConfirmation}
          onConfirm={confirmAction}
          loading={loading}
          danger={Boolean(selectedOption.confirmDanger)}
          backdropClassName="power-menu-confirmation-backdrop"
        />
      )}
    </>
  );
}

function PowerMenuOption({
  focusId,
  label,
  subtitle,
  icon: Icon,
  disabled = false,
  danger = false,
  onClick,
}: Readonly<{
  focusId: string;
  label: string;
  subtitle: string;
  icon: typeof PowerIcon;
  disabled?: boolean;
  danger?: boolean;
  onClick: () => void;
}>) {
  return (
    <FocusItem
      id={focusId}
      navigationState={disabled ? "disabled" : "active"}
      actions={{ primary: onClick }}
      asChild
    >
      <button
        type="button"
        className="power-menu__option"
        data-danger={danger || undefined}
        disabled={disabled}
        onClick={onClick}
        aria-label={label}
        aria-describedby={`${focusId}-description`}
      >
        <span className="power-menu__icon" aria-hidden="true">
          <Icon size={22} />
        </span>
        <span className="power-menu__copy">
          <span className="power-menu__label">{label}</span>
          <span className="power-menu__subtitle" id={`${focusId}-description`}>
            {subtitle}
          </span>
        </span>
        <CaretRightIcon className="power-menu__chevron" size={16} aria-hidden />
      </button>
    </FocusItem>
  );
}
