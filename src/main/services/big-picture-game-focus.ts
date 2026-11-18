import { logger } from "./logger";
import { NativeAddon, type SystemProcessMap } from "./native-addon";
import {
  resolveGameCandidatePids,
  selectPreferredGameWindow,
  shouldAttemptWindowFocus,
} from "./big-picture-game-focus-policy";

export const BIG_PICTURE_FOCUS_POLL_INTERVAL_MS = 150;
export const BIG_PICTURE_FOCUS_TIMEOUT_MS = 20_000;
export const BIG_PICTURE_INTERNAL_TRANSITION_GRACE_MS = 500;
const MAX_FOCUS_ATTEMPTS_PER_HANDLE = 3;

export interface LaunchFocusTarget {
  gameKey: string;
  executablePaths?: string[];
  pid?: number | null;
}

export interface BigPictureFocusHost {
  isBigPictureOpen: () => boolean;
  isBigPictureFocused: () => boolean;
  getBigPictureNativeHandle: () => string | null;
  getGameLauncherNativeHandle: () => string | null;
  getMode: () => "keep-open" | "minimize" | "hide";
  blurBigPicture: () => void;
}

interface HandoffSession {
  gameKey: string;
  rootPids: Set<number>;
  executablePaths: Set<string>;
  alreadyFocusedHandles: Set<string>;
  focusAttemptsByHandle: Map<string, number>;
  hasFocusedAnyWindow: boolean;
  deadlineAt: number;
  timer: ReturnType<typeof setTimeout> | null;
  inFlight: boolean;
  stopped: boolean;
}

export class BigPictureGameFocusHandoff {
  private static readonly sessions = new Map<string, HandoffSession>();
  private static internalTransitionUntil = 0;

  public static markInternalWindowTransition(
    durationMs = BIG_PICTURE_INTERNAL_TRANSITION_GRACE_MS
  ) {
    this.internalTransitionUntil = Math.max(
      this.internalTransitionUntil,
      Date.now() + durationMs
    );
  }

  public static isInInternalWindowTransition(now = Date.now()) {
    return now <= this.internalTransitionUntil;
  }

  public static begin(
    target: LaunchFocusTarget,
    host: BigPictureFocusHost
  ): void {
    if (process.platform !== "win32") return;
    if (!host.isBigPictureOpen()) return;

    NativeAddon.allowWindowsSetForegroundWindow();

    const existing = this.sessions.get(target.gameKey);
    const now = Date.now();
    if (existing) {
      for (const exe of target.executablePaths ?? []) {
        if (exe.trim()) existing.executablePaths.add(exe);
      }
      if (target.pid && target.pid > 0) {
        existing.rootPids.add(target.pid);
      }
      existing.deadlineAt = Math.max(
        existing.deadlineAt,
        now + BIG_PICTURE_FOCUS_TIMEOUT_MS
      );
      return;
    }

    const session: HandoffSession = {
      gameKey: target.gameKey,
      rootPids: new Set(target.pid && target.pid > 0 ? [target.pid] : []),
      executablePaths: new Set(
        (target.executablePaths ?? []).filter(
          (entry) => entry.trim().length > 0
        )
      ),
      alreadyFocusedHandles: new Set(),
      focusAttemptsByHandle: new Map(),
      hasFocusedAnyWindow: false,
      deadlineAt: now + BIG_PICTURE_FOCUS_TIMEOUT_MS,
      timer: null,
      inFlight: false,
      stopped: false,
    };

    this.sessions.set(target.gameKey, session);
    this.scheduleNextTick(session, host, 100);
  }

  public static addProcessId(gameKey: string, pid: number | null | undefined) {
    if (!pid || pid <= 0) return;
    const session = this.sessions.get(gameKey);
    if (!session) return;
    session.rootPids.add(pid);
    if (process.platform === "win32") {
      NativeAddon.allowWindowsSetForegroundWindow(pid);
    }
  }

  public static addExecutablePath(
    gameKey: string,
    executablePath: string | null | undefined
  ) {
    if (!executablePath || !executablePath.trim()) return;
    const session = this.sessions.get(gameKey);
    if (!session) return;
    session.executablePaths.add(executablePath);
  }

  public static onBigPictureManualFocus() {
    if (this.isInInternalWindowTransition()) return;
    for (const [gameKey, session] of this.sessions) {
      if (session.hasFocusedAnyWindow) {
        this.cancel(gameKey);
      }
    }
  }

  public static cancel(gameKey: string) {
    const session = this.sessions.get(gameKey);
    if (!session) return;
    session.stopped = true;
    if (session.timer) {
      clearTimeout(session.timer);
      session.timer = null;
    }
    this.sessions.delete(gameKey);
  }

  public static cancelAll() {
    for (const gameKey of Array.from(this.sessions.keys())) {
      this.cancel(gameKey);
    }
  }

  private static scheduleNextTick(
    session: HandoffSession,
    host: BigPictureFocusHost,
    delayMs = BIG_PICTURE_FOCUS_POLL_INTERVAL_MS
  ) {
    if (session.stopped || session.timer) return;
    session.timer = setTimeout(() => {
      session.timer = null;
      void this.tick(session, host);
    }, delayMs);
    session.timer.unref?.();
  }

  private static async tick(
    session: HandoffSession,
    host: BigPictureFocusHost
  ) {
    if (session.stopped || session.inFlight) return;
    if (!host.isBigPictureOpen() || Date.now() > session.deadlineAt) {
      this.cancel(session.gameKey);
      return;
    }

    session.inFlight = true;
    try {
      const systemMap: SystemProcessMap | null =
        await NativeAddon.getSystemProcessMap();
      if (session.stopped || !host.isBigPictureOpen()) {
        this.cancel(session.gameKey);
        return;
      }

      const candidatePids = resolveGameCandidatePids({
        rootPids: session.rootPids,
        executablePaths: session.executablePaths,
        processTree: systemMap?.processTree,
      });

      if (candidatePids.length === 0) {
        return;
      }

      const foreground = NativeAddon.getWindowsForegroundWindow();
      const foregroundPidSet = new Set(candidatePids);
      if (foreground && foregroundPidSet.has(foreground.processId)) {
        session.alreadyFocusedHandles.add(foreground.windowHandle);
        session.hasFocusedAnyWindow = true;
        if (host.getMode() === "keep-open" && host.isBigPictureFocused()) {
          this.markInternalWindowTransition(250);
          host.blurBigPicture();
        }
        return;
      }

      const windows = NativeAddon.findWindowsByProcessIds(candidatePids);
      const bigPictureHandle = host.getBigPictureNativeHandle();
      const gameLauncherHandle = host.getGameLauncherNativeHandle();

      // If closing the desktop launch popup transiently bounced focus back to
      // Big Picture while a game window already exists, recover focus onto it.
      const bouncedToBigPicture =
        this.isInInternalWindowTransition() &&
        Boolean(
          bigPictureHandle && foreground?.windowHandle === bigPictureHandle
        );

      const target = selectPreferredGameWindow(
        windows,
        bouncedToBigPicture ? new Set() : session.alreadyFocusedHandles
      );

      if (
        !shouldAttemptWindowFocus({
          target,
          hasFocusedAnyWindow: session.hasFocusedAnyWindow,
          foregroundHandle: foreground?.windowHandle ?? null,
          bigPictureHandle,
          gameLauncherHandle,
        })
      ) {
        return;
      }

      if (!target) return;

      NativeAddon.allowWindowsSetForegroundWindow(target.processId);
      const lowerHandle =
        host.getMode() === "keep-open" ? bigPictureHandle : null;
      this.markInternalWindowTransition(350);
      const focused = NativeAddon.focusWindowsWindow(
        target.windowHandle,
        lowerHandle
      );
      const attempts =
        (session.focusAttemptsByHandle.get(target.windowHandle) ?? 0) + 1;
      session.focusAttemptsByHandle.set(target.windowHandle, attempts);

      if (focused || attempts >= MAX_FOCUS_ATTEMPTS_PER_HANDLE) {
        session.alreadyFocusedHandles.add(target.windowHandle);
      }

      if (focused) {
        session.hasFocusedAnyWindow = true;
        if (host.getMode() === "keep-open") {
          host.blurBigPicture();
        }
        logger.info("Focused launched game window from Big Picture", {
          gameKey: session.gameKey,
          processId: target.processId,
          windowHandle: target.windowHandle,
        });
      }
    } catch (error) {
      logger.warn("Big Picture game window focus handoff failed", {
        gameKey: session.gameKey,
        error,
      });
    } finally {
      session.inFlight = false;
      if (!session.stopped && Date.now() <= session.deadlineAt) {
        this.scheduleNextTick(session, host);
      } else {
        this.cancel(session.gameKey);
      }
    }
  }
}
