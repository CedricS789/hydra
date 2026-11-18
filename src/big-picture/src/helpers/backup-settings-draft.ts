import type { LudusaviLocalSettings } from "@types";

export function withGameBackupEnabled(
  current: LudusaviLocalSettings,
  baseline: LudusaviLocalSettings | undefined,
  key: string,
  enabled: boolean
): LudusaviLocalSettings {
  const games = { ...current.games };
  const next = {
    ...(games[key] ?? { savePaths: [], trackingPaths: [] }),
    enabled,
  };
  // Turning a default-on game off and back on must restore the original draft.
  if (
    !baseline?.games[key] &&
    enabled &&
    !next.savePaths.length &&
    !next.trackingPaths.length &&
    Object.keys(next).every((field) =>
      ["enabled", "savePaths", "trackingPaths"].includes(field)
    )
  ) {
    delete games[key];
  } else games[key] = next;
  return { ...current, games };
}
