import { getDownloadersForUri } from "./download-uri.js";
import { getUriGroupDownloaders } from "./repack-uri-groups.js";
import type { GameRepack } from "../types/index";
import type {
  BlockedSourceNavigation,
  SourceBrowserRequest,
  SourceWebsiteProfile,
} from "../types/source-browser.types";

/** Stable identity key for a source browser window request shared by main and renderer. */
export function sourceBrowserRequestKey(request: SourceBrowserRequest): string {
  const sourceId =
    request?.websiteProfileId ?? request?.repack?.downloadSourceId ?? "";
  return JSON.stringify([
    sourceId,
    request.shop,
    request.objectId,
    request.gameTitle,
    request.readOnly === true,
    request.repack.title,
    request.repack.sourcePageUrl ?? "",
  ]);
}

export const isSourceBrowsingEnabled = (
  preferences?: { enableSourceBrowser?: boolean } | null
) => preferences?.enableSourceBrowser !== false;

const defaultWebsiteRank = (profile: SourceWebsiteProfile) => {
  const identity = `${profile.name ?? ""} ${profile.website}`.toLowerCase();
  if (identity.includes("steamrip")) return 0;
  if (identity.includes("fitgirl")) return 1;
  if (identity.includes("dodi")) return 2;
  return 3;
};

/** Put configured search websites in the saved user order, with new sites appended by the product defaults. */
export function orderSourceWebsiteProfiles(
  profiles: Record<string, SourceWebsiteProfile>,
  savedOrder?: string[] | null
) {
  const ids = Object.keys(profiles);
  const savedRank = new Map((savedOrder ?? []).map((id, index) => [id, index]));
  return ids.sort((a, b) => {
    const aSaved = savedRank.get(a);
    const bSaved = savedRank.get(b);
    if (aSaved !== undefined || bSaved !== undefined) {
      if (aSaved === undefined) return 1;
      if (bSaved === undefined) return -1;
      if (aSaved !== bSaved) return aSaved - bSaved;
    }
    const rank =
      defaultWebsiteRank(profiles[a]) - defaultWebsiteRank(profiles[b]);
    if (rank) return rank;
    return (profiles[a].name ?? a).localeCompare(profiles[b].name ?? b);
  });
}

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
    sourceOrigin: "website",
    websiteProfileId: id,
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

const TRADEMARK_SYMBOLS = /[\u2122\u00ae\u00a9\u2120™®©℠]/g;
const APOSTROPHES = /['’`\u2018\u2019]/g;
const DOTTED_ACRONYM = /\b([a-z])(?:\.([a-z])){2,}\b\.?/g;
const PARENTHETICAL_TAG_RE =
  /\s*\((?:(?:19|20)\d{2}|pc|goty|remake|remastered|definitive edition|complete edition)\)\s*$/i;
const EDITION_SUFFIX_RE =
  /\s*(?:-|:)?\s*\b(?:game of the year(?: edition)?|goty(?: edition)?|directors?['’]?s? cut|(?:digital )?(?:deluxe|ultimate|definitive|complete|gold|silver|platinum|anniversary|enhanced|special|collectors?['’]?s?|standard|legendary|legacy|royal|expanded|premium|launch|limited) edition|remastered|remake|hd(?: remaster(?:ed)?)?|edition)\s*$/i;
const CREATOR_PREFIX_RE = /^[a-z0-9\s.'-]{2,30}['’]s\s+/i;
const QUERY_PLACEHOLDER = "HYDRA_QUERY_PLACEHOLDER";

const ROMAN_NUMERALS: Record<string, string> = {
  ii: "2",
  iii: "3",
  iv: "4",
  v: "5",
  vi: "6",
  vii: "7",
  viii: "8",
  ix: "9",
  x: "10",
  xi: "11",
  xii: "12",
  xiii: "13",
  xiv: "14",
  xv: "15",
};

const TITLE_STOPWORDS = new Set([
  "the",
  "a",
  "an",
  "of",
  "and",
  "in",
  "on",
  "at",
  "to",
  "for",
  "by",
  "with",
]);

const EDITION_WORDS = new Set([
  "edition",
  "goty",
  "remastered",
  "remake",
  "hd",
  "directors",
  "director",
  "cut",
  "definitive",
  "complete",
  "ultimate",
  "deluxe",
  "gold",
  "anniversary",
  "enhanced",
  "special",
  "collectors",
  "collector",
  "standard",
  "legendary",
  "premium",
  "legacy",
  "digital",
]);

const SEARCH_NOISE_WORDS = new Set([
  ...TITLE_STOPWORDS,
  ...EDITION_WORDS,
  "pc",
  "free",
  "download",
  "repack",
  "fitgirl",
  "dodi",
  "steamrip",
  "full",
  "game",
  "crack",
  "dlc",
  "dlcs",
  "all",
]);

const SLUG_NOISE_WORDS = new Set([
  ...SEARCH_NOISE_WORDS,
  "iso",
  "torrent",
  "incl",
  "including",
  "bonus",
  "bonuses",
  "multi",
  "build",
  "update",
  "updated",
  "patch",
  "hotfix",
  "online",
  "coop",
  "multiplayer",
  "from",
  "v",
]);

const VERSION_PREFIX_WORDS = new Set([
  "v",
  "ver",
  "version",
  "build",
  "update",
  "patch",
  "rev",
  "r",
  "multi",
  "dlc",
  "dlcs",
]);

const SMALL_INSTALLMENT_RE = /^([1-9]|1\d|20|ii|iii|iv|v|vi|vii|viii|ix|x)$/;

/** Strip trademark symbols that break search indexing on most source websites. */
export function sourceSearchQuery(gameTitle: string): string {
  const cleaned = gameTitle
    .replace(TRADEMARK_SYMBOLS, "")
    .replace(/\s+/g, " ")
    .trim();
  return cleaned || gameTitle;
}

function normalizeText(value: string): string {
  return value
    .replace(TRADEMARK_SYMBOLS, "")
    .replace(APOSTROPHES, "")
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(DOTTED_ACRONYM, (match) => match.replace(/\./g, ""))
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function tokenize(value: string): string[] {
  const normalized = normalizeText(value);
  return normalized ? normalized.split(" ") : [];
}

function stripTitleModifiers(gameTitle: string): string {
  let current = gameTitle.replace(TRADEMARK_SYMBOLS, "").trim();
  for (let i = 0; i < 4; i++) {
    const next = current
      .replace(PARENTHETICAL_TAG_RE, "")
      .replace(EDITION_SUFFIX_RE, "")
      .trim();
    if (!next || next === current) break;
    current = next;
  }
  return current || gameTitle;
}

function canonicalNumberToken(tokens: string[], index: number): string | null {
  const token = tokens[index];
  if (!token) return null;
  if (/^\d+$/.test(token)) return String(Number(token));
  if (token === "v" && index > 0 && !/^\d+$/.test(tokens[index + 1] ?? "")) {
    return "5";
  }
  if (
    token === "i" &&
    index > 0 &&
    /^(part|episode|chapter|act|vol|book)$/i.test(tokens[index - 1] ?? "")
  ) {
    return "1";
  }
  if (token in ROMAN_NUMERALS && token !== "v") return ROMAN_NUMERALS[token];
  return null;
}

function isVersionNumberAt(tokens: string[], index: number): boolean {
  if (!/^\d+$/.test(tokens[index] ?? "")) return false;
  let cursor = index - 1;
  while (cursor >= 0 && /^\d+$/.test(tokens[cursor])) cursor--;
  const prev = tokens[cursor];
  if (prev && (VERSION_PREFIX_WORDS.has(prev) || /^v\d+$/.test(prev))) {
    return true;
  }
  const next = tokens[index + 1];
  return Boolean(next && /^(dlc|dlcs)$/.test(next));
}

function extractNumberSet(tokens: string[]): Set<string> {
  const numbers = new Set<string>();
  for (let i = 0; i < tokens.length; i++) {
    if (isVersionNumberAt(tokens, i)) continue;
    const num = canonicalNumberToken(tokens, i);
    if (num !== null) numbers.add(num);
  }
  return numbers;
}

function editDistance(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  const prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  const curr = new Array<number>(b.length + 1);
  for (let i = 1; i <= a.length; i++) {
    curr[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(curr[j - 1] + 1, prev[j] + 1, prev[j - 1] + cost);
    }
    for (let j = 0; j <= b.length; j++) prev[j] = curr[j];
  }
  return prev[b.length];
}

function wordsFuzzyEqual(a: string, b: string, allowPrefix: boolean): boolean {
  if (a === b) return true;
  if (/^\d+$/.test(a) || /^\d+$/.test(b)) return false;
  if (allowPrefix && a.length >= 4 && b.startsWith(a)) return true;
  const minLen = Math.min(a.length, b.length);
  if (minLen >= 8 && editDistance(a, b) <= 2) return true;
  if (minLen >= 5 && editDistance(a, b) <= 1) return true;
  return false;
}

function buildTitleAcronyms(tokens: string[]): Set<string> {
  const acronyms = new Set<string>();
  const add = (list: string[]) => {
    if (list.length >= 2) acronyms.add(list.map((t) => t[0]).join(""));
  };
  add(tokens);
  add(tokens.filter((t) => !TITLE_STOPWORDS.has(t)));
  const withoutTrailingNumber = tokens.slice(
    0,
    tokens.length > 2 &&
      canonicalNumberToken(tokens, tokens.length - 1) !== null
      ? -1
      : tokens.length
  );
  add(withoutTrailingNumber);
  add(withoutTrailingNumber.filter((t) => !TITLE_STOPWORDS.has(t)));
  return acronyms;
}

function tokenMatchesTarget(
  sourceTokens: string[],
  sourceIndex: number,
  targetTokens: string[],
  allowPrefix: boolean
): { matched: boolean; consumed: number; targetIndex: number } {
  const token = sourceTokens[sourceIndex];
  const sourceNum = canonicalNumberToken(sourceTokens, sourceIndex);

  for (let j = 0; j < targetTokens.length; j++) {
    const targetNum = canonicalNumberToken(targetTokens, j);
    if (sourceNum !== null && targetNum !== null) {
      if (sourceNum === targetNum)
        return { matched: true, consumed: 1, targetIndex: j };
      continue;
    }
    if (wordsFuzzyEqual(token, targetTokens[j], allowPrefix)) {
      return { matched: true, consumed: 1, targetIndex: j };
    }
    if (
      j + 1 < targetTokens.length &&
      wordsFuzzyEqual(token, `${targetTokens[j]}${targetTokens[j + 1]}`, false)
    ) {
      return { matched: true, consumed: 1, targetIndex: j };
    }
    if (
      j + 2 < targetTokens.length &&
      wordsFuzzyEqual(
        token,
        `${targetTokens[j]}${targetTokens[j + 1]}${targetTokens[j + 2]}`,
        false
      )
    ) {
      return { matched: true, consumed: 1, targetIndex: j };
    }
  }

  if (sourceIndex + 1 < sourceTokens.length) {
    const joined = `${token}${sourceTokens[sourceIndex + 1]}`;
    for (let j = 0; j < targetTokens.length; j++) {
      if (wordsFuzzyEqual(joined, targetTokens[j], allowPrefix)) {
        return { matched: true, consumed: 2, targetIndex: j };
      }
    }
  }

  return { matched: false, consumed: 1, targetIndex: -1 };
}

function isWordPressSearchPagePath(
  urlPathname: string,
  templatePathname: string
): boolean {
  if (urlPathname === templatePathname) return true;
  const base = templatePathname.replace(/\/+$/, "");
  const escaped = base.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`^${escaped}/page/\\d+/?$`).test(urlPathname);
}

function extractSearchQueryFromUrl(
  url: URL,
  profile: SourceWebsiteProfile
): string | null {
  const template = websiteUrl(
    profile.searchUrl.replaceAll("{query}", QUERY_PLACEHOLDER)
  );
  if (url.origin !== template.origin) return null;

  const isAllowedExtraParam = (key: string) =>
    ((key === "paged" || key === "page") &&
      /^\d+$/.test(url.searchParams.get(key) ?? "")) ||
    key === "post_type" ||
    /^utm_(source|medium|campaign|term|content)$/i.test(key);

  let queryParamKey: string | null = null;
  let queryParamPattern = "";
  for (const [key, value] of template.searchParams) {
    if (value.includes(QUERY_PLACEHOLDER)) {
      queryParamKey = key;
      queryParamPattern = value;
      break;
    }
  }

  if (queryParamKey !== null) {
    if (!isWordPressSearchPagePath(url.pathname, template.pathname))
      return null;
    if (
      ![...url.searchParams.keys()].every(
        (key) => template.searchParams.has(key) || isAllowedExtraParam(key)
      )
    )
      return null;
    for (const [key, value] of template.searchParams) {
      if (url.searchParams.getAll(key).length !== 1) return null;
      if (key !== queryParamKey && url.searchParams.get(key) !== value)
        return null;
    }
    const rawValue = url.searchParams.get(queryParamKey) ?? "";
    const [prefix, suffix] = queryParamPattern.split(QUERY_PLACEHOLDER);
    if (!rawValue.startsWith(prefix) || !rawValue.endsWith(suffix)) return null;
    return rawValue.slice(prefix.length, rawValue.length - suffix.length);
  }

  if (template.pathname.includes(QUERY_PLACEHOLDER)) {
    if (
      ![...url.searchParams.keys()].every(
        (key) => template.searchParams.has(key) || isAllowedExtraParam(key)
      )
    )
      return null;
    for (const [key, value] of template.searchParams) {
      if (
        url.searchParams.getAll(key).length !== 1 ||
        url.searchParams.get(key) !== value
      )
        return null;
    }
    const [prefix, suffix] = template.pathname.split(QUERY_PLACEHOLDER);
    const cleanedPath = url.pathname.replace(/\/page\/\d+\/?$/, "");
    const candidatePath =
      suffix === "" && cleanedPath !== url.pathname
        ? cleanedPath
        : url.pathname;
    if (!candidatePath.startsWith(prefix) || !candidatePath.endsWith(suffix))
      return null;
    const rawSegment = candidatePath.slice(
      prefix.length,
      candidatePath.length - suffix.length
    );
    return decodeURIComponent(rawSegment);
  }

  return null;
}

function isFuzzySearchMatch(rawQuery: string, gameTitle: string): boolean {
  const rawQueryTokens = tokenize(rawQuery);
  if (!rawQueryTokens.length) return false;

  const baseTitle = stripTitleModifiers(gameTitle);
  const rawTitleTokens = tokenize(gameTitle);
  const baseTitleTokens = tokenize(baseTitle);
  const titleTokens = baseTitleTokens.length ? baseTitleTokens : rawTitleTokens;
  if (!titleTokens.length) return false;

  const rawTitleSet = new Set(rawTitleTokens);
  const titleNumbers = extractNumberSet(rawTitleTokens);
  const acronyms = buildTitleAcronyms(titleTokens);

  // Split alphanumeric shortcuts like "gta5" or "bg3" when not directly in the title.
  const expandedQueryTokens: string[] = [];
  for (const token of rawQueryTokens) {
    const split = !rawTitleSet.has(token) && token.match(/^([a-z]{2,})(\d+)$/);
    if (split) expandedQueryTokens.push(split[1], split[2]);
    else expandedQueryTokens.push(token);
  }

  for (let i = 0; i < expandedQueryTokens.length; i++) {
    if (isVersionNumberAt(expandedQueryTokens, i)) continue;
    const num = canonicalNumberToken(expandedQueryTokens, i);
    if (num !== null && !titleNumbers.has(num)) {
      if (
        titleNumbers.size > 0 ||
        SMALL_INSTALLMENT_RE.test(expandedQueryTokens[i])
      )
        return false;
    }
  }

  const meaningfulTokens = expandedQueryTokens.filter(
    (token, i) =>
      rawTitleSet.has(token) ||
      canonicalNumberToken(expandedQueryTokens, i) !== null ||
      !SEARCH_NOISE_WORDS.has(token)
  );
  if (!meaningfulTokens.length) return false;

  let matchedCount = 0;
  let matchedChars = 0;
  let acronymHits = 0;
  let lastMatchedAcronym = "";

  for (let i = 0; i < meaningfulTokens.length; i++) {
    const token = meaningfulTokens[i];
    const direct = tokenMatchesTarget(
      meaningfulTokens,
      i,
      rawTitleTokens,
      true
    );
    if (direct.matched) {
      matchedCount++;
      matchedChars += token.length;
      if (direct.consumed === 2 && i + 1 < meaningfulTokens.length) {
        matchedCount++;
        matchedChars += meaningfulTokens[i + 1].length;
        i++;
      }
      continue;
    }
    if (acronyms.has(token) && token.length >= 2) {
      matchedCount++;
      matchedChars += token.length;
      acronymHits++;
      lastMatchedAcronym = token;
    }
  }

  if (matchedCount === 0) return false;
  if (
    acronymHits === 1 &&
    matchedCount === 1 &&
    lastMatchedAcronym.length < 3
  ) {
    return false;
  }

  const minChars = Math.min(3, rawTitleTokens.join("").length);
  if (matchedChars < minChars) return false;

  const ratio = matchedCount / meaningfulTokens.length;
  return meaningfulTokens.length <= 2 ? ratio === 1 : ratio >= 0.65;
}

interface TitleMatchSummary {
  matchedCount: number;
  totalCount: number;
  lastSlugIndex: number;
  inOrderLeadingCount: number;
}

function matchTitleAgainstSlug(
  titleTokens: string[],
  slugTokens: string[]
): TitleMatchSummary {
  let matchedCount = 0;
  let lastSlugIndex = -1;
  let inOrderLeadingCount = 0;
  let leadingBroken = false;
  let inOrderCursor = 0;

  for (let i = 0; i < titleTokens.length; i++) {
    const result = tokenMatchesTarget(titleTokens, i, slugTokens, false);
    if (result.matched) {
      matchedCount++;
      if (result.consumed === 2 && i + 1 < titleTokens.length) {
        matchedCount++;
        i++;
      }
      if (result.targetIndex > lastSlugIndex)
        lastSlugIndex = result.targetIndex;
      if (!leadingBroken && result.targetIndex >= inOrderCursor) {
        inOrderLeadingCount++;
        inOrderCursor = result.targetIndex + 1;
      } else {
        leadingBroken = true;
      }
    } else {
      leadingBroken = true;
    }
  }

  return {
    matchedCount,
    totalCount: titleTokens.length,
    lastSlugIndex,
    inOrderLeadingCount,
  };
}

function isFuzzyGamePageMatch(url: URL, gameTitle: string): boolean {
  const segments = url.pathname
    .split("/")
    .filter(Boolean)
    .map((s) => decodeURIComponent(s));
  if (!segments.length) return false;

  let rawSlug = segments[segments.length - 1];
  if (/^\d+$/.test(rawSlug) && segments.length >= 2) {
    rawSlug = segments[segments.length - 2];
  }
  rawSlug = rawSlug.replace(/\.(html?|php|aspx?)$/i, "");
  const slugTokens = tokenize(rawSlug);
  if (!slugTokens.length) return false;

  const baseTitle = stripTitleModifiers(gameTitle);
  const rawTitleTokens = tokenize(gameTitle);
  const baseTitleTokens = tokenize(baseTitle);
  const effectiveBaseTokens = baseTitleTokens.length
    ? baseTitleTokens
    : rawTitleTokens;
  const meaningfulTitleTokens = effectiveBaseTokens.filter(
    (t) => !TITLE_STOPWORDS.has(t)
  );
  const coreTokens = meaningfulTitleTokens.length
    ? meaningfulTitleTokens
    : effectiveBaseTokens;
  if (coreTokens.join("").length < 2) return false;

  const requiredNumbers = extractNumberSet(effectiveBaseTokens);
  const slugNumbers = extractNumberSet(slugTokens);
  for (const reqNum of requiredNumbers) {
    if (!slugNumbers.has(reqNum)) return false;
  }

  // Reject installment numbers appearing in the slug that are not in the title.
  for (let i = 0; i < slugTokens.length; i++) {
    const token = slugTokens[i];
    if (SLUG_NOISE_WORDS.has(token) && !rawTitleTokens.includes(token)) {
      if (token === "free" || token === "download" || token === "repack") break;
      continue;
    }
    if (isVersionNumberAt(slugTokens, i)) continue;
    if (/^v\d+/.test(token)) break;
    if (SMALL_INSTALLMENT_RE.test(token)) {
      const num = canonicalNumberToken(slugTokens, i);
      if (num !== null && !requiredNumbers.has(num)) return false;
    }
  }

  const fullSummary = matchTitleAgainstSlug(coreTokens, slugTokens);

  const noCreatorText = baseTitle.replace(CREATOR_PREFIX_RE, "").trim();
  const noCreatorTokens =
    noCreatorText !== baseTitle
      ? tokenize(noCreatorText).filter((t) => !TITLE_STOPWORDS.has(t))
      : [];
  const noCreatorSummary = noCreatorTokens.length
    ? matchTitleAgainstSlug(noCreatorTokens, slugTokens)
    : null;

  const primaryText = baseTitle.split(/\s*(?::|-\s+)\s*/)[0]?.trim() ?? "";
  const primaryTokens =
    primaryText && primaryText !== baseTitle
      ? tokenize(primaryText).filter((t) => !TITLE_STOPWORDS.has(t))
      : [];
  const primarySummary = primaryTokens.length
    ? matchTitleAgainstSlug(primaryTokens, slugTokens)
    : null;

  const lastMatchIdx = Math.max(
    fullSummary.lastSlugIndex,
    noCreatorSummary?.lastSlugIndex ?? -1,
    primarySummary?.lastSlugIndex ?? -1
  );
  if (lastMatchIdx >= 0) {
    let nextIdx = lastMatchIdx + 1;
    while (
      nextIdx < slugTokens.length &&
      EDITION_WORDS.has(slugTokens[nextIdx])
    ) {
      nextIdx++;
    }
    const nextToken = slugTokens[nextIdx];
    if (
      nextToken &&
      !isVersionNumberAt(slugTokens, nextIdx) &&
      SMALL_INSTALLMENT_RE.test(nextToken)
    ) {
      const nextNum = canonicalNumberToken(slugTokens, nextIdx);
      if (nextNum !== null && !requiredNumbers.has(nextNum)) return false;
    }
    if (
      nextToken &&
      /^(part|episode|chapter)$/i.test(nextToken) &&
      slugTokens[nextIdx + 1] &&
      SMALL_INSTALLMENT_RE.test(slugTokens[nextIdx + 1])
    ) {
      const partNum = canonicalNumberToken(slugTokens, nextIdx + 1);
      if (partNum !== null && !requiredNumbers.has(partNum)) return false;
    }
  }

  const unmatchedSlugWords: string[] = [];
  for (let i = 0; i < slugTokens.length; i++) {
    const token = slugTokens[i];
    if (token === "free" || token === "download" || token === "repack") break;
    if (/^(v\d+|multi\d+|win\d+|dx\d+|build\d+)$/.test(token)) break;
    if (VERSION_PREFIX_WORDS.has(token) || isVersionNumberAt(slugTokens, i))
      break;
    if (SLUG_NOISE_WORDS.has(token) && !rawTitleTokens.includes(token))
      continue;
    const slugMatch = tokenMatchesTarget(slugTokens, i, rawTitleTokens, false);
    if (slugMatch.matched) {
      if (slugMatch.consumed === 2) i++;
      continue;
    }
    unmatchedSlugWords.push(token);
  }

  const fullRatio = fullSummary.matchedCount / fullSummary.totalCount;
  const strongFullMatch =
    fullRatio >= 0.6 &&
    fullSummary.matchedCount >= Math.min(2, fullSummary.totalCount) &&
    (fullRatio === 1 || unmatchedSlugWords.length === 0);

  const creatorMatch =
    noCreatorSummary !== null &&
    noCreatorSummary.matchedCount === noCreatorSummary.totalCount;

  const primaryMatch =
    primarySummary !== null &&
    primarySummary.matchedCount === primarySummary.totalCount &&
    primaryTokens.join("").length >= 4 &&
    unmatchedSlugWords.length === 0;

  const leadingPrefixMatch =
    fullSummary.inOrderLeadingCount >= 2 && unmatchedSlugWords.length === 0;

  const acronyms = buildTitleAcronyms(effectiveBaseTokens);
  const acronymMatch =
    requiredNumbers.size > 0 &&
    unmatchedSlugWords.every((w) => acronyms.has(w)) &&
    unmatchedSlugWords.some((w) => acronyms.has(w));

  return (
    strongFullMatch ||
    creatorMatch ||
    primaryMatch ||
    leadingPrefixMatch ||
    acronymMatch
  );
}

function isSameSourceSiteHost(
  candidateHost: string,
  sourceHost: string
): boolean {
  const stripWww = (host: string) => host.toLowerCase().replace(/^www\./, "");
  return stripWww(candidateHost) === stripWww(sourceHost);
}

// Conservative address matching: URLs that cannot establish their title are
// blocked. The URL is a hint, not proof of the page's contents or its links.
export function sourceGamePageKind(
  raw: string,
  gameTitle: string,
  profile: SourceWebsiteProfile
): "search" | "game" | "blocked" {
  try {
    const url = websiteUrl(raw);
    const valid = validateWebsiteProfile(profile);
    if (!valid.approvedDomains!.includes(url.hostname)) return "blocked";
    const sourceHost = new URL(valid.website).hostname;
    if (!isSameSourceSiteHost(url.hostname, sourceHost)) return "game";
    const searchQuery = extractSearchQueryFromUrl(url, profile);
    if (searchQuery !== null) {
      return isFuzzySearchMatch(searchQuery, gameTitle) ? "search" : "blocked";
    }
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
    return isFuzzyGamePageMatch(url, gameTitle) ? "game" : "blocked";
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
  const isWebsiteSelection = repack.sourceOrigin === "website";
  return {
    ...repack,
    title: releaseTitle.trim(),
    uris: mode === "parts" ? [validated[0]] : validated,
    uriGroups: mode === "parts" ? [validated] : undefined,
    unavailableUris: [],
    fileSize: !isWebsiteSelection && sameRelease ? repack.fileSize : null,
    uploadDate: !isWebsiteSelection && sameRelease ? repack.uploadDate : null,
    sourcePageUrl: websiteUrl(pageUrl).href,
  };
}
