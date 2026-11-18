import type { GameLauncherStatus, GameLauncherStatusPayload } from "@types";

import { WindowManager } from "./window-manager";
import { logger } from "./logger";

type GameLauncherStatusGroup = "compatibility" | "achievements" | "launch";

const COMPATIBILITY_STATUSES = new Set<GameLauncherStatus>([
  "preparing_compatibility_layer",
  "compatibility_layer_ready",
  "compatibility_layer_failed",
  "game_started",
]);

const latestStatuses = new Map<
  string,
  Map<GameLauncherStatusGroup, GameLauncherStatusPayload>
>();

const detectedGames = new Set<string>();
const requestStartedAt = new Map<string, number>();

const getStatusGroup = (status: GameLauncherStatus): GameLauncherStatusGroup =>
  status.startsWith("launch_")
    ? "launch"
    : COMPATIBILITY_STATUSES.has(status)
      ? "compatibility"
      : "achievements";

export const getGameLauncherStatuses = (gameKey: string) => [
  ...(latestStatuses.get(gameKey)?.values() ?? []),
];

export const clearGameLauncherStatuses = (gameKey: string) => {
  latestStatuses.delete(gameKey);
  detectedGames.delete(gameKey);
  requestStartedAt.set(gameKey, performance.now());
};

export const wasGameLauncherGameDetected = (gameKey: string) =>
  detectedGames.has(gameKey);

export const markGameLauncherGameDetected = (gameKey: string) => {
  detectedGames.add(gameKey);
  sendGameLauncherStatus(gameKey, "game_started");
};

export const sendGameLauncherStatus = (
  gameKey: string,
  status: GameLauncherStatus,
  detail: string | null = null
) => {
  const payload: GameLauncherStatusPayload = { gameKey, status, detail };
  if (status.startsWith("launch_") || status === "game_started") {
    logger.info("[Game launch] Stage", {
      gameKey,
      status,
      elapsedMs: Math.round(
        performance.now() - (requestStartedAt.get(gameKey) ?? performance.now())
      ),
    });
  }
  const statuses = latestStatuses.get(gameKey) ?? new Map();
  statuses.set(getStatusGroup(status), payload);
  latestStatuses.set(gameKey, statuses);

  WindowManager.sendToAppWindows("game-launcher-status", payload);

  const gameLauncherWindow = WindowManager.gameLauncherWindow;

  if (!gameLauncherWindow || gameLauncherWindow.isDestroyed()) return;

  gameLauncherWindow.webContents.send("game-launcher-status", payload);
};
