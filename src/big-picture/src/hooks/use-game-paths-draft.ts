import { useState } from "react";
import type { LudusaviGameSettings } from "@types";

/** Keep an edited game's paths from ever appearing as another game's draft. */
export function useGamePathsDraft(key: string, saved: LudusaviGameSettings) {
  const [draft, setDraft] = useState<{
    key: string;
    saves: string;
    tracking: string;
  } | null>(null);
  const savePathsText =
    draft?.key === key ? draft.saves : saved.savePaths.join("\n");
  const trackingPathsText =
    draft?.key === key ? draft.tracking : saved.trackingPaths.join("\n");
  return {
    savePathsText,
    trackingPathsText,
    setSavePathsText: (saves: string) =>
      setDraft({ key, saves, tracking: trackingPathsText }),
    setTrackingPathsText: (tracking: string) =>
      setDraft({ key, saves: savePathsText, tracking }),
    discardPaths: () => setDraft(null),
  };
}
