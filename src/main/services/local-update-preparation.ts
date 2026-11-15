import type { LocalRelease, LocalReleaseState } from "../../types/index";

export function getUpdatePreparation(
  baseTag: string,
  latest: LocalRelease | undefined,
  url: string,
  workflow?: { state: string },
  run?: {
    status: string;
    conclusion: string | null;
    created_at: string;
    html_url: string;
  },
  adapted: LocalRelease[] = []
): NonNullable<LocalReleaseState["preparation"]> {
  const value = { officialTag: latest?.tag ?? baseTag, url };
  if (!latest) return { ...value, phase: "unknown" };
  const prefix = `v${latest.tag.replace(/^v/, "")}-remix.`;
  if (
    latest.tag !== baseTag &&
    adapted.some(
      (release) =>
        release.tag.startsWith(prefix) &&
        /^\d+$/.test(release.tag.slice(prefix.length))
    )
  )
    return { ...value, phase: "available" };
  if (!workflow) return { ...value, phase: "unknown" };
  if (workflow.state !== "active") return { ...value, phase: "disabled" };
  if (latest.tag === baseTag) return { ...value, phase: "current" };
  if (
    run?.status === "completed" &&
    ["failure", "timed_out", "action_required", "startup_failure"].includes(
      run.conclusion ?? ""
    ) &&
    Date.parse(run.created_at) >= Date.parse(latest.publishedAt)
  )
    return { ...value, phase: "failed", url: run.html_url };
  return { ...value, phase: "preparing" };
}
