import type { BigPictureGameWindowMode, UserPreferences } from "@types";
import {
  DEFAULT_BIG_PICTURE_GAME_WINDOW_MODE,
  normalizeBigPictureGameWindowMode,
} from "@shared";
import {
  BigPictureGameFocusHandoff,
  type BigPictureFocusHost,
  type LaunchFocusTarget,
} from "./big-picture-game-focus";
import {
  hasTrackedGamesRunning,
  onTrackedGamesRunningChange,
} from "./game-running-state";
import { resolveBigPictureGameWindowTransition } from "./big-picture-game-window-policy";
import { WindowManager } from "./window-manager";

export class BigPictureGameWindowService {
  private static mode: BigPictureGameWindowMode =
    DEFAULT_BIG_PICTURE_GAME_WINDOW_MODE;
  private static initialized = false;
  private static shuttingDown = false;
  private static gamesRunning = false;
  private static readonly launchingGameKeys = new Set<string>();
  private static pendingGamesRunningCheck: ReturnType<
    typeof setImmediate
  > | null = null;
  private static unsubscribeGamesRunning: (() => void) | null = null;

  private static readonly focusHost: BigPictureFocusHost = {
    isBigPictureOpen: () => WindowManager.isBigPictureOpen(),
    isBigPictureFocused: () => WindowManager.isBigPictureFocused(),
    getBigPictureNativeHandle: () => WindowManager.getBigPictureNativeHandle(),
    getGameLauncherNativeHandle: () =>
      WindowManager.getGameLauncherNativeHandle(),
    getMode: () => this.mode,
    blurBigPicture: () => WindowManager.yieldBigPictureForGameLaunch(),
  };

  public static syncUserPreferences(preferences: UserPreferences | null) {
    this.mode = normalizeBigPictureGameWindowMode(
      preferences?.bigPictureGameWindowMode
    );

    if (!this.initialized) {
      this.initialized = true;
      this.gamesRunning = hasTrackedGamesRunning();
      this.unsubscribeGamesRunning = onTrackedGamesRunningChange(() =>
        this.scheduleGamesRunningCheck()
      );
    }

    if (!this.shuttingDown) {
      this.reconcile(false);
    }
  }

  public static notifyGameLaunchDispatching(target: LaunchFocusTarget) {
    if (this.shuttingDown || !WindowManager.isBigPictureOpen()) return;

    const hadLaunchingGames = this.launchingGameKeys.size > 0;
    this.launchingGameKeys.add(target.gameKey);
    const launchTransitionedToActive = !hadLaunchingGames;

    if (this.mode === "keep-open") {
      WindowManager.yieldBigPictureForGameLaunch();
    } else {
      this.reconcile(false, launchTransitionedToActive);
    }

    BigPictureGameFocusHandoff.begin(target, this.focusHost);
  }

  public static notifyGameLaunchProcessSpawned(
    gameKey: string,
    pid: number | null | undefined
  ) {
    if (this.shuttingDown) return;
    BigPictureGameFocusHandoff.addProcessId(gameKey, pid);
  }

  public static notifyGameLaunchDetected(
    gameKey: string,
    matchedPath?: string | null
  ) {
    this.launchingGameKeys.delete(gameKey);
    if (matchedPath) {
      BigPictureGameFocusHandoff.addExecutablePath(gameKey, matchedPath);
    }
  }

  public static notifyGameLaunchEnded(gameKey: string, succeeded: boolean) {
    this.launchingGameKeys.delete(gameKey);
    if (succeeded) return;

    BigPictureGameFocusHandoff.cancel(gameKey);
    if (!this.shuttingDown) {
      this.gamesRunning = hasTrackedGamesRunning();
      this.reconcile(false);
    }
  }

  public static notifyGameClosed(gameKey: string) {
    this.launchingGameKeys.delete(gameKey);
    BigPictureGameFocusHandoff.cancel(gameKey);
  }

  public static shutdown() {
    this.shuttingDown = true;
    this.launchingGameKeys.clear();
    BigPictureGameFocusHandoff.cancelAll();
    this.cancelGamesRunningCheck();
    this.unsubscribeGamesRunning?.();
    this.unsubscribeGamesRunning = null;
  }

  private static scheduleGamesRunningCheck() {
    if (this.pendingGamesRunningCheck) return;
    this.pendingGamesRunningCheck = setImmediate(() => {
      this.pendingGamesRunningCheck = null;
      if (this.shuttingDown) return;

      const running = hasTrackedGamesRunning();
      if (running === this.gamesRunning) return;

      const transitionedToRunning = !this.gamesRunning && running;
      this.gamesRunning = running;
      if (!running) {
        BigPictureGameFocusHandoff.cancelAll();
      }
      this.reconcile(transitionedToRunning);
    });
  }

  private static cancelGamesRunningCheck() {
    if (!this.pendingGamesRunningCheck) return;
    clearImmediate(this.pendingGamesRunningCheck);
    this.pendingGamesRunningCheck = null;
  }

  private static reconcile(
    gamesRunningChangedToTrue: boolean,
    launchTransitionedToActive = false
  ) {
    const action = resolveBigPictureGameWindowTransition({
      mode: this.mode,
      bigPictureOpen: WindowManager.isBigPictureOpen(),
      gamesRunning: this.gamesRunning,
      launchingGames: this.launchingGameKeys.size > 0,
      suspendedBy: WindowManager.getBigPictureSuspendedForGame(),
      gamesRunningChangedToTrue,
      launchTransitionedToActive,
    });

    if (action === "minimize" || action === "hide") {
      WindowManager.suspendBigPictureForGame(action);
      return;
    }

    if (action === "restore") {
      WindowManager.restoreBigPictureAfterGame();
    }
  }
}
