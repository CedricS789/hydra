import { getDownloadersForUri } from "./download-uri.js";
import { getUriGroupDownloaders } from "./repack-uri-groups.js";
import type { GameRepack } from "../types/index";
import type {
  BlockedSourceNavigation,
  SourceWebsiteProfile,
} from "../types/source-browser.types";

export const isSourceBrowsingEnabled = (
  preferences?: { enableSourceBrowser?: boolean } | null
) => preferences?.enableSourceBrowser !== false;

/** Keep the real platform and Chromium version, without application products. */
export function sourceWebsiteUserAgent(defaultAgent: string): string {
  const marker = " (KHTML, like Gecko)";
  const prefixEnd = defaultAgent.indexOf(marker);
  const chrome = defaultAgent.match(/\bChrome\/[\d.]+/);
  const safari = defaultAgent.match(/\bSafari\/[\d.]+/);
  return prefixEnd >= 0 && chrome && safari
    ? `${defaultAgent.slice(0, prefixEnd + marker.length)} ${chrome[0]} ${safari[0]}`
    : defaultAgent;
}

export function sourceWebsiteHttpError(status: number): string {
  if (status < 400) return "";
  if (status === 403)
    return "Website refused access (HTTP 403). Try Reload, or Open in browser and paste a supported download link.";
  if (status === 429)
    return "Website is limiting requests (HTTP 429). Wait before reloading, or use Open in browser.";
  return `Website returned HTTP ${status}. Try Reload or Open in browser.`;
}

export function websiteUrl(value: string): URL {
  if (typeof value !== "string" || value.length > 16384)
    throw new Error("Invalid website address.");
  const url = new URL(value);
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    (url.port && url.port !== "443")
  ) {
    throw new Error(
      "Use an HTTPS website address without credentials or a custom port."
    );
  }
  return url;
}

export function supportedSourceLink(value: string): string {
  if (typeof value !== "string" || value.length > 16384)
    throw new Error("Invalid download link.");
  const trimmed = value.trim();
  const url = new URL(trimmed);
  if (url.protocol === "magnet:") {
    if (
      !url.searchParams
        .getAll("xt")
        .some((xt) => /^urn:btih:([a-f0-9]{40}|[a-z2-7]{32})$/i.test(xt))
    ) {
      throw new Error("This magnet link has no valid torrent hash.");
    }
    return trimmed;
  }
  websiteUrl(trimmed);
  // Match only the parsed hostname, never a deceptive URL prefix such as
  // gofile.io.example.org. Keep actual download eligibility in Hydra's helper.
  if (!getDownloadersForUri(url.href).length) {
    throw new Error(
      "Unsupported download link. Select a magnet link or a hoster Hydra supports; ordinary webpage links cannot be downloaded."
    );
  }
  return url.href;
}

export function validateWebsiteProfile(
  profile: SourceWebsiteProfile
): SourceWebsiteProfile {
  const website = websiteUrl(profile.website).href;
  if (!profile.searchUrl.includes("{query}"))
    throw new Error("Search address must include {query}.");
  const search = websiteUrl(profile.searchUrl.replaceAll("{query}", "game"));
  if (search.hostname !== new URL(website).hostname)
    throw new Error("Search must use the source website's hostname.");
  if (
    profile.approvedDomains !== undefined &&
    (!Array.isArray(profile.approvedDomains) ||
      profile.approvedDomains.length > 100)
  )
    throw new Error("Use at most 100 approved hostnames.");
  const approvedDomains = [
    ...new Set(
      [new URL(website).hostname, ...(profile.approvedDomains ?? [])].map(
        normalizeApprovedDomain
      )
    ),
  ];
  if (approvedDomains.length > 100)
    throw new Error(
      "Use at most 100 approved hostnames, including the source website."
    );
  const name = profile.name?.trim();
  if (name !== undefined && (!name || name.length > 120))
    throw new Error("Use a website name between 1 and 120 characters.");
  return {
    ...(name ? { name } : {}),
    website,
    searchUrl: profile.searchUrl,
    approvedDomains,
  };
}

/** A browsing context only: no feed entry or downloadable links are created. */
export function websiteSearchRepack(
  id: string,
  profile: SourceWebsiteProfile,
  gameTitle: string
): GameRepack {
  const valid = validateWebsiteProfile(profile);
  return {
    id: `website-search:${id}`,
    title: gameTitle,
    fileSize: null,
    uploadDate: null,
    createdAt: "",
    uris: [],
    unavailableUris: [],
    downloadSourceId: id,
    downloadSourceName: valid.name ?? new URL(valid.website).hostname,
  };
}

export function normalizeApprovedDomain(value: string): string {
  if (
    typeof value !== "string" ||
    !value.trim() ||
    /[\s/\\?#@:*%]/.test(value.trim())
  )
    throw new Error(
      "Enter exact hostnames only, without URLs, paths, ports, or wildcards."
    );
  const hostname = new URL(`https://${value.trim()}`).hostname.toLowerCase();
  if (
    hostname.length > 253 ||
    !hostname
      .split(".")
      .every((label) => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label))
  )
    throw new Error("Invalid approved hostname.");
  return hostname;
}

export type SourceNavigationDecision =
  | { action: "allow" | "collect"; url: string }
  | { action: "block"; blocked: BlockedSourceNavigation };

// Conservative address matching: URLs that cannot establish their title are
// blocked. The URL is a hint, not proof of the page's contents or its links.
export function sourceGamePageKind(
  raw: string,
  gameTitle: string,
  profile: SourceWebsiteProfile
): "search" | "game" | "blocked" {
  try {
    const url = websiteUrl(raw);
    const search = websiteUrl(
      profile.searchUrl.replaceAll("{query}", encodeURIComponent(gameTitle))
    );
    const normalize = (s: string) =>
      s
        .normalize("NFKD")
        .replace(/\p{M}/gu, "")
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, " ")
        .trim();
    if (
      url.origin === search.origin &&
      url.pathname === search.pathname &&
      [...url.searchParams.keys()].every(
        (key) =>
          search.searchParams.has(key) ||
          (key === "paged" && /^\d+$/.test(url.searchParams.get(key) ?? ""))
      ) &&
      [...search.searchParams].every(
        ([key, value]) =>
          url.searchParams.getAll(key).length === 1 &&
          normalize(url.searchParams.get(key) ?? "") === normalize(value)
      )
    )
      return "search";
    if (
      [...url.searchParams.keys()].some((key) =>
        /^(s|q|query|search)$/i.test(key)
      )
    )
      return "blocked";
    if (
      [...url.searchParams.keys()].some(
        (key) => !/^utm_(source|medium|campaign|term|content)$/i.test(key)
      )
    )
      return "blocked";
    const title = normalize(gameTitle)
      .replace(
        /\s+(director s cut|directors cut|definitive edition|complete edition|remastered|enhanced edition|game of the year edition)$/,
        ""
      )
      .trim();
    if (title.replace(/\s/g, "").length < 4) return "blocked";
    const tokens = title.split(" ");
    const pathname = normalize(
      decodeURIComponent(url.pathname.split("/").filter(Boolean).at(-1) ?? "")
    );
    const pathTokens = pathname.split(" ");
    const start = pathTokens.findIndex((_, i) =>
      tokens.every((token, j) => pathTokens[i + j] === token)
    );
    if (start < 0) return "blocked";
    const next = pathTokens[start + tokens.length];
    if (next && /^(\d+|ii|iii|iv|v|vi|vii|viii|ix|x)$/.test(next))
      return "blocked";
    return "game";
  } catch {
    return "blocked";
  }
}

export function sourceNavigationDecision(
  raw: string,
  profile: SourceWebsiteProfile | null
): SourceNavigationDecision {
  try {
    return { action: "collect", url: supportedSourceLink(raw) };
  } catch {
    /* It may be an ordinary page. */
  }
  let url: URL;
  try {
    url = websiteUrl(raw);
  } catch {
    return {
      action: "block",
      blocked: {
        hostname: null,
        reason: "incompatible-address",
        message:
          "Blocked an incompatible address. Only approved HTTPS pages and supported download links can be opened.",
      },
    };
  }
  if (!profile)
    return {
      action: "block",
      blocked: {
        hostname: url.hostname,
        reason: "profile-required",
        message:
          "Configure this source in Settings → Advanced → Features → Source website profiles and cookies before browsing.",
      },
    };
  const approved = validateWebsiteProfile(profile).approvedDomains!;
  if (!approved.includes(url.hostname))
    return {
      action: "block",
      blocked: {
        hostname: url.hostname,
        reason: "unapproved-domain",
        message: `Blocked navigation to ${url.hostname}. Manage approved domains in Settings → Advanced → Features → Source website profiles and cookies.`,
      },
    };
  return { action: "allow", url: url.href };
}

export function suggestedWebsiteProfile(
  name: string
): SourceWebsiteProfile | null {
  const sites: Record<string, string> = {
    fitgirl: "https://fitgirl-repacks.site/",
    dodi: "https://dodi-repacks.site/",
    steamrip: "https://steamrip.com/",
  };
  const site = sites[name.toLowerCase().replace(/[^a-z0-9]/g, "")];
  return site ? { website: site, searchUrl: `${site}?s={query}` } : null;
}

export function buildSourceSelection(
  repack: GameRepack,
  links: string[],
  mode: "single" | "mirrors" | "parts",
  releaseTitle: string,
  pageUrl: string
): GameRepack {
  if (!releaseTitle.trim() || releaseTitle.length > 2000)
    throw new Error("Enter the release title you selected.");
  if (
    !links.length ||
    links.length > 100 ||
    new Set(links).size !== links.length
  )
    throw new Error("Select between 1 and 100 distinct links.");
  const validated = links.map(supportedSourceLink);
  if (
    !["single", "mirrors", "parts"].includes(mode) ||
    (validated.length > 1 && mode === "single")
  )
    throw new Error(
      "Choose alternative mirrors or ordered parts for multiple links."
    );
  if (
    mode === "parts" &&
    (validated.length < 2 ||
      !getUriGroupDownloaders(validated, getDownloadersForUri).length)
  )
    throw new Error(
      "These links cannot form a multipart download with Hydra's supported methods."
    );
  const sameRelease = releaseTitle.trim() === repack.title.trim();
  return {
    ...repack,
    title: releaseTitle.trim(),
    uris: mode === "parts" ? [validated[0]] : validated,
    uriGroups: mode === "parts" ? [validated] : undefined,
    unavailableUris: [],
    fileSize: sameRelease ? repack.fileSize : null,
    uploadDate: sameRelease ? repack.uploadDate : null,
    sourcePageUrl: websiteUrl(pageUrl).href,
  };
}
