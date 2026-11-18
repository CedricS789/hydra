export function getGameLaunchFailureMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : "";
  if (message.includes("game_launch_not_detected")) {
    return "The launch was dispatched, but its process was not detected within 60 seconds. Check whether the game is already opening before trying again.";
  }
  if (message.includes("game_executable_not_found")) {
    return "The game executable was not found. Select its current location in game options.";
  }
  return "The launch request failed. Check the game location and launcher logs, then try again.";
}
