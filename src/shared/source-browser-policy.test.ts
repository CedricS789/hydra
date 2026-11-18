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
  sourceSearchQuery,
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
  assert.equal(
    sourceGamePageKind("https://source.example/?s=Tsushima", title, profile),
    "search"
  );
  assert.equal(
    sourceGamePageKind(
      "https://source.example/page/2/?s=Ghost%20of%20Tsushima",
      title,
      profile
    ),
    "search"
  );
  assert.equal(
    sourceGamePageKind(
      "https://source.example/?s=Ghost%20of%20Tsushima%202",
      title,
      profile
    ),
    "blocked"
  );
  assert.equal(
    sourceGamePageKind(
      "https://source.example/?s=Ghost%20Recon",
      title,
      profile
    ),
    "blocked"
  );
  assert.equal(
    sourceGamePageKind("https://source.example/?s=", title, profile),
    "blocked"
  );
  assert.equal(
    sourceGamePageKind(
      "https://source.example/ghost-of-a-tale-free-download/",
      title,
      profile
    ),
    "blocked"
  );
  assert.equal(
    sourceGamePageKind(
      "https://source.example/ghostrunner-free-download/",
      title,
      profile
    ),
    "blocked"
  );
});

test("fuzzy safeguard handles shortened searches, trademarks, editions, numerals, and punctuation", () => {
  const profile = {
    website: "https://source.example/",
    searchUrl: "https://source.example/?s={query}",
  };
  const sekiro = "Sekiro™: Shadows Die Twice - GOTY Edition";
  assert.equal(
    sourceSearchQuery(sekiro),
    "Sekiro: Shadows Die Twice - GOTY Edition"
  );
  for (const url of [
    "https://source.example/?s=Sekiro%E2%84%A2%3A%20Shadows%20Die%20Twice%20-%20GOTY%20Edition",
    "https://source.example/?s=Sekiro",
    "https://source.example/?s=Sekiro%20Shadows%20Die%20Twice",
    "https://source.example/?s=Shadows%20Die%20Twice",
    "https://source.example/?s=Sekiro%20GOTY",
    "https://source.example/?s=Sekro",
  ]) {
    assert.equal(sourceGamePageKind(url, sekiro, profile), "search", url);
  }
  for (const url of [
    "https://source.example/sekiro-shadows-die-twice-free-download/",
    "https://source.example/sekiro-shadows-die-twice-goty-edition/",
    "https://source.example/sekiro-shadows-die-twice-v1-06-free-download/",
    "https://source.example/sekiro-free-download/",
  ]) {
    assert.equal(sourceGamePageKind(url, sekiro, profile), "game", url);
  }
  for (const url of [
    "https://source.example/?s=Sekiro%202",
    "https://source.example/?s=F1%202015",
    "https://source.example/sekiro-2-free-download/",
    "https://source.example/aviassembly-free-download/",
  ]) {
    assert.equal(sourceGamePageKind(url, sekiro, profile), "blocked", url);
  }

  assert.equal(
    sourceGamePageKind(
      "https://source.example/baldurs-gate-3-free-download/",
      "Baldur's Gate 3",
      profile
    ),
    "game"
  );
  assert.equal(
    sourceGamePageKind(
      "https://source.example/baldur-s-gate-3-free-download/",
      "Baldur's Gate 3",
      profile
    ),
    "game"
  );
  assert.equal(
    sourceGamePageKind(
      "https://source.example/?s=BG3",
      "Baldur's Gate 3",
      profile
    ),
    "search"
  );
  assert.equal(
    sourceGamePageKind(
      "https://source.example/spider-man-remastered-free-download/",
      "Marvel's Spider-Man Remastered",
      profile
    ),
    "game"
  );
  assert.equal(
    sourceGamePageKind(
      "https://source.example/?s=Spiderman",
      "Marvel's Spider-Man Remastered",
      profile
    ),
    "search"
  );
  assert.equal(
    sourceGamePageKind(
      "https://source.example/civilization-6-free-download/",
      "Sid Meier’s Civilization® VI",
      profile
    ),
    "game"
  );
  assert.equal(
    sourceGamePageKind(
      "https://source.example/gta-5-free-download/",
      "Grand Theft Auto V",
      profile
    ),
    "game"
  );
  assert.equal(
    sourceGamePageKind(
      "https://source.example/?s=GTA%205",
      "Grand Theft Auto V",
      profile
    ),
    "search"
  );
  assert.equal(
    sourceGamePageKind(
      "https://source.example/elden-ring-free-download/",
      "ELDEN RING Shadow of the Erdtree Edition",
      profile
    ),
    "game"
  );
  assert.equal(
    sourceGamePageKind(
      "https://source.example/resident-evil-4-remake-free-download/",
      "Resident Evil 4 (2023)",
      profile
    ),
    "game"
  );
  assert.equal(
    sourceGamePageKind(
      "https://source.example/stalker-2-heart-of-chornobyl-free-download/",
      "S.T.A.L.K.E.R. 2: Heart of Chornobyl",
      profile
    ),
    "game"
  );
  assert.equal(
    sourceGamePageKind(
      "https://source.example/nierautomata-free-download/",
      "NieR:Automata™",
      profile
    ),
    "game"
  );
  assert.equal(
    sourceGamePageKind(
      "https://source.example/call-of-duty-modern-warfare-free-download/",
      "Call of Duty: Black Ops",
      profile
    ),
    "blocked"
  );
  assert.equal(
    sourceGamePageKind(
      "https://source.example/the-witcher-2-free-download/",
      "The Witcher® 3: Wild Hunt - Complete Edition",
      profile
    ),
    "blocked"
  );
  assert.equal(
    sourceGamePageKind(
      "https://source.example/red-dead-redemption-free-download/",
      "Red Dead Redemption 2",
      profile
    ),
    "blocked"
  );

  const pathProfile = {
    website: "https://source.example/",
    searchUrl: "https://source.example/search/{query}",
  };
  assert.equal(
    sourceGamePageKind(
      "https://source.example/search/Sekiro",
      sekiro,
      pathProfile
    ),
    "search"
  );
  assert.equal(
    sourceGamePageKind(
      "https://source.example/search/F1%202015",
      sekiro,
      pathProfile
    ),
    "blocked"
  );

  const containerProfile = {
    website: "https://steamrip.com/",
    searchUrl: "https://steamrip.com/?s={query}",
    approvedDomains: ["www.filecrypt.cc", "www.steamrip.com"],
  };
  assert.equal(
    sourceGamePageKind(
      "https://steamrip.com/sekiro-shadows-die-twice-free-download-c2/",
      sekiro,
      containerProfile
    ),
    "game"
  );
  assert.equal(
    sourceGamePageKind(
      "https://www.filecrypt.cc/Container/ABCD1234.html",
      sekiro,
      containerProfile
    ),
    "game"
  );
  assert.equal(
    sourceGamePageKind(
      "https://www.filecrypt.cc/Link/1234?id=99",
      sekiro,
      containerProfile
    ),
    "game"
  );
  assert.equal(
    sourceGamePageKind(
      "https://www.steamrip.com/f1-2015-free-download/",
      sekiro,
      containerProfile
    ),
    "blocked"
  );
  assert.equal(
    sourceGamePageKind(
      "https://unapproved.example/Container/ABCD1234.html",
      sekiro,
      containerProfile
    ),
    "blocked"
  );
});
