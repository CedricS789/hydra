export const REMOTE_SETUP_REQUIRED = "SAVE_REMOTE_NOT_CONFIGURED:";

/** Electron wraps rejected IPC messages; keep the useful error for the UI. */
export function saveManagerError(error: unknown) {
  let message = error instanceof Error ? error.message : String(error);
  for (let i = 0; i < 3; i++) {
    message = message
      .replace(/^Error:\s*/, "")
      .replace(/^Error invoking remote method '[^']+':\s*/, "");
  }
  return {
    message,
    remoteSetupRequired: message.startsWith(REMOTE_SETUP_REQUIRED),
  };
}
