import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildSourceSelection,
  isSourceBrowsingEnabled,
  supportedSourceLink,
  validateWebsiteProfile,
  websiteUrl,
  sourceWebsiteUserAgent,
  sourceWebsiteHttpError,
  sourceNavigationDecision,
  sourceGamePageKind,
  normalizeApprovedDomain,
  websiteSearchRepack,
} from "./source-browser-policy.js";
import type { GameRepack } from "@types";

test("standalone website searches produce a reviewable selection without a feed", () => {
  const context = websiteSearchRepack(
    "website:standalone",
    {
      name: "Independent website",
      website: "https://source.example/",
      searchUrl: "https://source.example/?s={query}",
    },
    "Fixture Game"
  );
  assert.deepEqual(context.uris, []);
  assert.equal(context.sourcePageUrl, undefined);
  const selection = buildSourceSelection(
    context,
    ["https://gofile.io/d/fixture"],
    "single",
    "Fixture Game v2",
    "https://source.example/fixture-game/"
  );
  assert.equal(selection.downloadSourceId, "website:standalone");
  assert.equal(selection.downloadSourceName, "Independent website");
  assert.equal(selection.title, "Fixture Game v2");
  assert.equal(selection.fileSize, null);
  assert.equal(selection.uploadDate, null);
  assert.deepEqual(selection.uris, ["https://gofile.io/d/fixture"]);
});

const repack: GameRepack = {
  id: "release",
  title: "Game v1",
  uris: [],
  unavailableUris: [],
  fileSize: "10 GB",
  uploadDate: "2026-01-01",
  downloadSourceId: "source",
  downloadSourceName: "Source",
  createdAt: "",
};
const page = "https://source.example/game-v1/";
test("legacy profiles approve only their configured website hostname", () => {
  const profile = validateWebsiteProfile({
    website: page,
    searchUrl: "https://source.example/?s={query}",
  });
  assert.deepEqual(profile.approvedDomains, ["source.example"]);
  assert.equal(sourceNavigationDecision(page, profile).action, "allow");
  for (const address of [
    "https://source.example.evil.org/",
    "https://www.source.example/",
    "https://sub.source.example/",
    "https://other.example/",
  ]) {
    const result = sourceNavigationDecision(address, profile);
    assert.equal(result.action, "block");
    if (result.action === "block")
      assert.equal(result.blocked.reason, "unapproved-domain");
  }
});
test("domain exceptions are explicit and profile creation never grants implicit subdomains", () => {
  const profile = validateWebsiteProfile({
    website: page,
    searchUrl: "https://source.example/?s={query}",
    approvedDomains: ["WWW.source.example", "www.source.example"],
  });
  assert.deepEqual(profile.approvedDomains, [
    "source.example",
    "www.source.example",
  ]);
  assert.equal(
    sourceNavigationDecision("https://www.source.example/page", profile).action,
    "allow"
  );
  assert.equal(
    sourceNavigationDecision("https://nested.www.source.example/", profile)
      .action,
    "block"
  );
  for (const domain of [
    "*.source.example",
    "https://source.example/",
    "source.example/path",
    "name@source.example",
    "source.example:443",
    "source.example?x=1",
    "bad domain.example",
    "source.example\\evil",
    "",
  ])
    assert.throws(() => normalizeApprovedDomain(domain));
});
test("missing profiles block page addresses, while supported links still enter collection", () => {
  const missing = sourceNavigationDecision(page, null);
  assert.equal(missing.action, "block");
  if (missing.action === "block")
    assert.equal(missing.blocked.reason, "profile-required");
  assert.equal(
    sourceNavigationDecision("https://gofile.io/d/file", null).action,
    "collect"
  );
  for (const value of [
    "file:///C:/secret",
    "javascript:alert(1)",
    "http://source.example/",
    "https://u:p@source.example/",
    "https://source.example:8443/",
  ])
    assert.equal(
      sourceNavigationDecision(value, {
        website: page,
        searchUrl: "https://source.example/?s={query}",
      }).action,
      "block"
    );
});
test("website browser identity retains the actual engine and OS without app branding", () => {
  const prefix =
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko)";
  const expected = `${prefix} Chrome/146.0.7680.216 Safari/537.36`;
  assert.equal(
    sourceWebsiteUserAgent(
      `${prefix} hydralauncher-local/4.4.1-remix.3 Chrome/146.0.7680.216 Electron/41.10.3 Safari/537.36`
    ),
    expected
  );
  assert.equal(sourceWebsiteUserAgent(expected), expected);
  assert.equal(sourceWebsiteUserAgent("unknown"), "unknown");
});
test("HTTP refusals and rate limits have distinct visible explanations", () => {
  assert.equal(sourceWebsiteHttpError(200), "");
  assert.match(sourceWebsiteHttpError(403), /refused access.*403/);
  assert.match(sourceWebsiteHttpError(429), /limiting requests.*429/);
  assert.match(sourceWebsiteHttpError(404), /HTTP 404/);
});
test("browsing starts enabled and respects explicit disable", () => {
  assert.equal(isSourceBrowsingEnabled(undefined), true);
  assert.equal(isSourceBrowsingEnabled({}), true);
  assert.equal(isSourceBrowsingEnabled({ enableSourceBrowser: false }), false);
});
test("source navigation rejects privileged schemes and embedded credentials", () => {
  for (const url of [
    "file:///C:/secret",
    "javascript:alert(1)",
    "data:text/html,test",
    "http://example.org",
    "https://user:password@example.org",
    "https://example.org:8443/",
  ])
    assert.throws(() => websiteUrl(url));
  assert.equal(websiteUrl(page).hostname, "source.example");
});
test("download links reject deceptive hosts, credentials and invalid magnets", () => {
  for (const url of [
    "https://gofile.io.example.org/a",
    "https://gofile.io@evil.example/a",
    "https://gofile.io:444/a",
    "https://example.org/file.zip",
    "magnet:?dn=game",
    "magnet:?xt=urn:btih:not-a-hash",
  ])
    assert.throws(() => supportedSourceLink(url));
  assert.equal(
    supportedSourceLink("https://gofile.io/d/fixture"),
    "https://gofile.io/d/fixture"
  );
  assert.match(
    supportedSourceLink(`magnet:?xt=urn:btih:${"a".repeat(40)}`),
    /^magnet:/
  );
});
test("website search profiles require explicit query and the same source host", () => {
  assert.throws(() =>
    validateWebsiteProfile({
      website: page,
      searchUrl: "https://evil.example/?s={query}",
    })
  );
  assert.throws(() =>
    validateWebsiteProfile({
      website: page,
      searchUrl: "https://source.example/search",
    })
  );
  assert.equal(
    validateWebsiteProfile({
      website: page,
      searchUrl: "https://source.example/?s={query}",
    }).website,
    page
  );
});
test("parts retain their order and do not become alternative mirrors", () => {
  const links = ["https://gofile.io/d/part2", "https://gofile.io/d/part1"];
  const result = buildSourceSelection(
    repack,
    links,
    "parts",
    repack.title,
    page
  );
  assert.deepEqual(result.uris, [links[0]]);
  assert.deepEqual(result.uriGroups, [links]);
  assert.equal(result.sourcePageUrl, page);
  assert.equal(result.downloadSourceId, repack.downloadSourceId);
  assert.throws(() =>
    buildSourceSelection(
      repack,
      [links[0], "https://pixeldrain.com/u/part2"],
      "parts",
      repack.title,
      page
    )
  );
  assert.throws(() =>
    buildSourceSelection(repack, links, "single", repack.title, page)
  );
});
test("changing releases drops misleading size and upload date; empty and duplicate selections fail", () => {
  const link = "https://gofile.io/d/fixture";
  const result = buildSourceSelection(
    repack,
    [link],
    "single",
    "Game v2",
    page
  );
  assert.equal(result.fileSize, null);
  assert.equal(result.uploadDate, null);
  assert.equal(result.title, "Game v2");
  assert.throws(() =>
    buildSourceSelection(repack, [], "single", repack.title, page)
  );
  assert.throws(() =>
    buildSourceSelection(repack, [link, link], "parts", repack.title, page)
  );
});

test("source page addresses stay within the selected game", () => {
  const profile = {
    website: "https://source.example/",
    searchUrl: "https://source.example/?s={query}",
  };
  const title = "Ghost of Tsushima DIRECTOR'S CUT";
  assert.equal(
    sourceGamePageKind(
      "https://source.example/?s=Ghost%20of%20Tsushima%20DIRECTOR%27S%20CUT",
      title,
      profile
    ),
    "search"
  );
  assert.equal(
    sourceGamePageKind(
      "https://source.example/ghost-of-tsushima-free-download/",
      title,
      profile
    ),
    "game"
  );
  assert.equal(
    sourceGamePageKind(
      "https://source.example/f1-2015-free-download/",
      title,
      profile
    ),
    "blocked"
  );
  assert.equal(
    sourceGamePageKind("https://source.example/?s=F1%202015", title, profile),
    "blocked"
  );
  assert.equal(
    sourceGamePageKind(
      "https://source.example/ghost-of-tsushima-2/",
      title,
      profile
    ),
    "blocked"
  );
});
