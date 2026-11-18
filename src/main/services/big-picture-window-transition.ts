export interface TransitionWindowHandle {
  isDestroyed: () => boolean;
  isMinimized: () => boolean;
  isVisible: () => boolean;
  isFocused: () => boolean;
  restore: () => void;
  show: () => void;
  hide: () => void;
  focus: () => void;
  maximize: () => void;
  setFullScreen: (flag: boolean) => void;
  setOpacity: (opacity: number) => void;
  setFocusable: (focusable: boolean) => void;
  setIgnoreMouseEvents: (ignore: boolean) => void;
  setSkipTaskbar: (skip: boolean) => void;
}

export type BackgroundFocusFn<T extends TransitionWindowHandle> = (
  window: T
) => void;

export interface ActivateBigPictureTransitionParams<
  T extends TransitionWindowHandle,
> {
  bigPicture: T | null | undefined;
  mainWindow: T | null | undefined;
  focusSteal?: boolean;
  hadForegroundAtStart?: boolean;
  mainWasVisible?: boolean;
  focusFromBackground: BackgroundFocusFn<T>;
}

export interface RestoreMainWindowTransitionParams<
  T extends TransitionWindowHandle,
> {
  mainWindow: T | null | undefined;
  bigPicture: T | null | undefined;
  deferredMainMaximize: boolean;
  preserveForeground?: boolean;
  focusFromBackground: BackgroundFocusFn<T>;
}

export interface RestoreMainWindowTransitionResult {
  restored: boolean;
  consumedDeferredMaximize: boolean;
}

/**
 * Hides and disables the desktop main window once Big Picture is active so it
 * cannot intercept Alt-Tab focus or input while Big Picture is open.
 */
export const disableMainWindowForBigPicture = <
  T extends TransitionWindowHandle,
>(
  mainWindow: T | null | undefined
) => {
  if (!mainWindow || mainWindow.isDestroyed()) return;

  mainWindow.setOpacity(1);
  mainWindow.hide();
  mainWindow.setFocusable(false);
  mainWindow.setIgnoreMouseEvents(true);
};

/**
 * Activates and focuses Big Picture before hiding the desktop main window so
 * Hydra never drops to zero visible windows during the transition.
 */
export const activateBigPictureWindowTransition = <
  T extends TransitionWindowHandle,
>({
  bigPicture,
  mainWindow,
  focusSteal = false,
  hadForegroundAtStart = false,
  mainWasVisible = false,
  focusFromBackground,
}: ActivateBigPictureTransitionParams<T>) => {
  if (!bigPicture || bigPicture.isDestroyed()) return;

  if (bigPicture.isMinimized()) {
    bigPicture.restore();
  }
  bigPicture.show();
  bigPicture.setFullScreen(true);

  if (focusSteal) {
    focusFromBackground(bigPicture);
  } else {
    bigPicture.focus();
    if (!bigPicture.isFocused() && (hadForegroundAtStart || !mainWasVisible)) {
      focusFromBackground(bigPicture);
    }
  }

  disableMainWindowForBigPicture(mainWindow);
};

/**
 * Restores, shows, and focuses the desktop main window before Big Picture
 * closes so the OS does not transfer foreground activation to another app.
 */
export const restoreMainWindowForBigPictureExit = <
  T extends TransitionWindowHandle,
>({
  mainWindow,
  bigPicture,
  deferredMainMaximize,
  preserveForeground,
  focusFromBackground,
}: RestoreMainWindowTransitionParams<T>): RestoreMainWindowTransitionResult => {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return { restored: false, consumedDeferredMaximize: false };
  }

  const shouldPreserveForeground =
    preserveForeground ??
    Boolean(
      bigPicture &&
        !bigPicture.isDestroyed() &&
        (bigPicture.isFocused() || bigPicture.isVisible())
    );

  mainWindow.setIgnoreMouseEvents(false);
  mainWindow.setFocusable(true);
  mainWindow.setSkipTaskbar(false);
  mainWindow.setOpacity(1);

  if (mainWindow.isMinimized()) {
    mainWindow.restore();
  }

  mainWindow.show();

  if (deferredMainMaximize) {
    mainWindow.maximize();
  }

  mainWindow.focus();

  if (shouldPreserveForeground && !mainWindow.isFocused()) {
    focusFromBackground(mainWindow);
  }

  return {
    restored: true,
    consumedDeferredMaximize: deferredMainMaximize,
  };
};
