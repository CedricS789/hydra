import type { BigPictureGameWindowMode } from "@types";

export type BigPictureGameWindowSuspension = "minimize" | "hide" | null;

export type BigPictureGameWindowTransition =
  | "none"
  | "minimize"
  | "hide"
  | "restore";

export interface BigPictureGameWindowPolicyInput {
  mode: BigPictureGameWindowMode;
  bigPictureOpen: boolean;
  gamesRunning: boolean;
  launchingGames?: boolean;
  suspendedBy: BigPictureGameWindowSuspension;
  gamesRunningChangedToTrue: boolean;
  launchTransitionedToActive?: boolean;
}

export const resolveBigPictureGameWindowTransition = ({
  mode,
  bigPictureOpen,
  gamesRunning,
  launchingGames = false,
  suspendedBy,
  gamesRunningChangedToTrue,
  launchTransitionedToActive = false,
}: BigPictureGameWindowPolicyInput): BigPictureGameWindowTransition => {
  if (!bigPictureOpen) {
    return "none";
  }

  const gameActive = gamesRunning || launchingGames;
  if (!gameActive || mode === "keep-open") {
    return suspendedBy !== null ? "restore" : "none";
  }

  // Only suspend when transitioning into an active launch/running game or when
  // switching between suspend modes while already suspended, so reopening Big
  // Picture manually mid-game is never overridden.
  if (
    gamesRunningChangedToTrue ||
    launchTransitionedToActive ||
    suspendedBy !== null
  ) {
    if (suspendedBy === mode) {
      return "none";
    }
    return mode;
  }

  return "none";
};
