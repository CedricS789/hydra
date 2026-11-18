export interface ResolveWindowIconOptions {
  platform: NodeJS.Platform;
  isPackaged: boolean;
  pngIcon: string;
  winIcoIcon: string;
}

/**
 * Selects the `BrowserWindow` `icon` constructor option for the current host.
 *
 * Packaged Windows builds omit `icon` so Windows reads the multi-resolution
 * `RT_GROUP_ICON` embedded in the executable rather than overriding `WM_SETICON`
 * from a single PNG bitmap; unpackaged Windows runs use a `.ico` asset so dev
 * windows do not fall back to the generic `electron.exe` icon.
 */
export const resolveWindowIconOption = ({
  platform,
  isPackaged,
  pngIcon,
  winIcoIcon,
}: ResolveWindowIconOptions): string | undefined => {
  if (platform === "win32") {
    return isPackaged ? undefined : winIcoIcon;
  }

  return pngIcon;
};
