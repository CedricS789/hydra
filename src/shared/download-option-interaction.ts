export type DownloadOptionInteraction = "menu" | "native" | "website-only";

export function getDownloadOptionInteraction(
  preferences?: { downloadOptionInteraction?: DownloadOptionInteraction } | null
): DownloadOptionInteraction {
  const mode = preferences?.downloadOptionInteraction;
  return mode === "menu" || mode === "website-only" ? mode : "native";
}
