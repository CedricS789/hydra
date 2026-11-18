import type { GameShop } from "./game.types";

export type UninstallMethod = "native-uninstaller" | "folder-delete";

export interface NativeUninstallerInfo {
  kind: "in-folder" | "registry-exe" | "registry-msi";
  label: string;
  executablePath: string;
  args: string[];
  requiresElevationHint?: boolean;
}

export type GameUninstallSafetyBlockReason =
  | "game-running"
  | "downloading"
  | "transferring"
  | "installer-running"
  | "unsafe-path"
  | "shared-with-other-game"
  | "symlink-target"
  | "missing-files";

export interface GameUninstallSafetyBlock {
  reason: GameUninstallSafetyBlockReason;
  details?: string;
}

export interface GameUninstallPlan {
  shop: GameShop;
  objectId: string;
  title: string;
  executablePath: string | null;
  gameRoot: string | null;
  gameRootSizeInBytes: number | null;
  canDeleteGameRoot: boolean;
  gameRootBlock: GameUninstallSafetyBlock | null;
  nativeUninstaller: NativeUninstallerInfo | null;
  downloadFolderPath: string | null;
  downloadFolderSizeInBytes: number | null;
  hasDownloadFolder: boolean;
  hasSourceArchive: boolean;
  isolatedWinePrefixPath: string | null;
  activityBlock: GameUninstallSafetyBlock | null;
}

export interface ExecuteGameUninstallOptions {
  mode: UninstallMethod;
  deleteDownloadFolder?: boolean;
  deleteSourceArchive?: boolean;
  deleteWinePrefix?: boolean;
  removeFromLibrary?: boolean;
}

export interface ExecuteGameUninstallResult {
  status:
    | "uninstalled"
    | "uninstaller-launched"
    | "cancelled-by-user"
    | "blocked";
  blockReason?: GameUninstallSafetyBlockReason;
  message?: string;
}
