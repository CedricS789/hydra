import { app } from "electron";
import updater from "electron-updater";
import { t } from "i18next";
import edition from "../../shared/local-edition.json";
import type {
  LocalRelease,
  LocalReleaseState,
  ReleaseSourceFile,
} from "@types";
import {
  compareReleaseTrees,
  type ReleaseTreeEntry,
} from "./local-release-source";
import { getTrackedGamesRunning } from "./game-running-state";
import { getLudusaviLocalState } from "./ludusavi-local";

const { autoUpdater } = updater;
const sourceRef = import.meta.env.MAIN_VITE_SOURCE_REF || edition.releaseTag;
const cache = new Map<string, { at: number; data: unknown }>();
const comparisons = new Map<string, ReleaseSourceFile[]>();
let updateState = { phase: "idle", version: "", error: "" };

const github = async <T>(resource: string, force = false): Promise<T> => {
  const existing = cache.get(resource);
  if (!force && existing && Date.now() - existing.at < 5 * 60_000)
    return existing.data as T;
  const response = await fetch(`https://api.github.com/repos/${resource}`, {
    headers: {
      Accept: "application/vnd.github+json",
      "User-Agent": "Hydra-Local-Releases",
    },
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok)
    throw new Error(
      t("local_releases:github_error", { status: response.status })
    );
  const data = await response.json();
  if (cache.size >= 80) cache.delete(cache.keys().next().value!);
  cache.set(resource, { at: Date.now(), data });
  return data as T;
};

const releases = async (
  repository: string,
  force = false
): Promise<LocalRelease[]> => {
  const data = await github<
    {
      tag_name: string;
      name: string;
      body: string;
      html_url: string;
      published_at: string;
      draft: boolean;
      prerelease: boolean;
    }[]
  >(`${repository}/releases?per_page=30`, force);
  return data
    .filter((r) => !r.draft && !r.prerelease)
    .map((r) => ({
      tag: r.tag_name,
      name: r.name || r.tag_name,
      notes: r.body || "",
      url: r.html_url,
      publishedAt: r.published_at,
    }));
};

export const getLocalReleases = async (
  force = false
): Promise<LocalReleaseState> => {
  const [custom, upstream] = await Promise.all([
    releases(edition.repository, force),
    releases(edition.upstreamRepository, force),
  ]);
  return {
    custom,
    upstream,
    version: app.getVersion(),
    sourceRef,
    upstreamTag: edition.upstreamTag,
  };
};

export const getReleaseSourceChanges = async (officialTag: string) => {
  if (
    !(await releases(edition.upstreamRepository)).some(
      (r) => r.tag === officialTag
    )
  )
    throw new Error(t("local_releases:release_required"));
  const getTree = async (repository: string, ref: string) => {
    const data = await github<{ tree: ReleaseTreeEntry[]; truncated: boolean }>(
      `${repository}/git/trees/${encodeURIComponent(ref)}?recursive=1`
    );
    if (data.truncated) throw new Error(t("local_releases:tree_truncated"));
    return data.tree;
  };
  const [official, custom] = await Promise.all([
    getTree(edition.upstreamRepository, officialTag),
    getTree(edition.repository, sourceRef),
  ]);
  const files = compareReleaseTrees(official, custom);
  comparisons.set(officialTag, files);
  return files;
};

export const getReleaseSourceFile = async (
  officialTag: string,
  filePath: string
) => {
  const files =
    comparisons.get(officialTag) ??
    (await getReleaseSourceChanges(officialTag));
  const file = files.find((f) => f.path === filePath);
  if (!file) throw new Error(t("local_releases:release_required"));
  const readBlob = async (repository: string, sha: string | null) => {
    if (!sha) return "";
    const blob = await github<{
      content: string;
      encoding: string;
      size: number;
    }>(`${repository}/git/blobs/${sha}`);
    if (blob.encoding !== "base64" || blob.size > 1024 * 1024)
      throw new Error(t("local_releases:binary_file"));
    const bytes = Buffer.from(blob.content, "base64");
    if (bytes.includes(0)) throw new Error(t("local_releases:binary_file"));
    return bytes.toString("utf8");
  };
  const [original, modified] = await Promise.all([
    readBlob(edition.upstreamRepository, file.originalSha),
    readBlob(edition.repository, file.modifiedSha),
  ]);
  return { original, modified };
};

export const getLocalUpdateState = () => updateState;

export const checkLocalReleaseUpdate = async () => {
  if (["checking", "downloading", "ready"].includes(updateState.phase))
    return updateState;
  updateState = { phase: "checking", version: "", error: "" };
  try {
    if (!app.isPackaged) throw new Error(t("local_releases:packaged_required"));
    if (!(await releases(edition.repository, true)).length) {
      updateState = {
        phase: "unpublished",
        version: app.getVersion(),
        error: "",
      };
      return updateState;
    }
    autoUpdater.autoDownload = false;
    autoUpdater.autoInstallOnAppQuit = false;
    let available = false;
    const onAvailable = () => {
      available = true;
    };
    autoUpdater.once("update-available", onAvailable);
    let result: Awaited<ReturnType<typeof autoUpdater.checkForUpdates>>;
    try {
      result = await autoUpdater.checkForUpdates();
    } finally {
      autoUpdater.removeListener("update-available", onAvailable);
    }
    updateState = {
      phase: available ? "available" : "current",
      version: result?.updateInfo.version ?? app.getVersion(),
      error: "",
    };
  } catch (error) {
    updateState = {
      phase: "error",
      version: "",
      error: error instanceof Error ? error.message : String(error),
    };
  }
  return updateState;
};

export const downloadLocalReleaseUpdate = async () => {
  if (updateState.phase !== "available")
    throw new Error(t("local_releases:check_first"));
  updateState = { ...updateState, phase: "downloading" };
  try {
    await autoUpdater.downloadUpdate();
    updateState = { ...updateState, phase: "ready" };
  } catch (error) {
    updateState = {
      ...updateState,
      phase: "error",
      error: error instanceof Error ? error.message : String(error),
    };
  }
  return updateState;
};

export const assertLocalUpdateSafe = async () => {
  if (
    getTrackedGamesRunning(performance.now()).length ||
    (await getLudusaviLocalState()).busy
  )
    throw new Error(t("local_releases:game_running"));
};

export const installLocalReleaseUpdate = async () => {
  if (updateState.phase !== "ready")
    throw new Error(t("local_releases:check_first"));
  await assertLocalUpdateSafe();
  autoUpdater.quitAndInstall(false, true);
};
