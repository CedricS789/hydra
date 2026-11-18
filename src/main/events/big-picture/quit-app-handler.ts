export interface BigPictureQuitEvent<TSender = unknown, TFrame = unknown> {
  sender: TSender & { mainFrame: TFrame };
  senderFrame: TFrame | null | undefined;
}

export interface BigPictureQuitDeps<TSender> {
  isBigPictureSender: (sender: TSender) => boolean;
  quit: () => void;
}

/**
 * Validates that a quit request originates from the Big Picture main frame and
 * delegates to Electron's application quit handler.
 */
export function executeBigPictureQuitApp<TSender, TFrame>(
  event: BigPictureQuitEvent<TSender, TFrame>,
  { isBigPictureSender, quit }: BigPictureQuitDeps<TSender>
) {
  if (
    !isBigPictureSender(event.sender) ||
    event.senderFrame !== event.sender.mainFrame
  ) {
    throw new Error("Quit action requires the Big Picture window");
  }

  quit();
}
