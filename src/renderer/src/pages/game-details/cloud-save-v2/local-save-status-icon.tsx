import {
  CircleNotchIcon,
  FloppyDiskIcon,
  ProhibitIcon,
  ShieldCheckIcon,
  WarningCircleIcon,
} from "@phosphor-icons/react";

import type { CloudSavePresentationIcon } from "./cloud-save-presentation";

interface LocalSaveStatusIconProps {
  icon: CloudSavePresentationIcon;
  size?: number;
}

export function LocalSaveStatusIcon({
  icon,
  size = 20,
}: Readonly<LocalSaveStatusIconProps>) {
  switch (icon) {
    case "cloud-slash":
      return <ProhibitIcon size={size} weight="bold" />;
    case "spinner":
      return <CircleNotchIcon className="cloud-save-v2__spinner" size={size} />;
    case "synced":
      return <ShieldCheckIcon size={size} weight="fill" />;
    case "cloud-x":
    case "warning":
      return <WarningCircleIcon size={size} weight="fill" />;
    case "restore":
    case "upload":
    case "cloud":
    default:
      return <FloppyDiskIcon size={size} weight="fill" />;
  }
}
