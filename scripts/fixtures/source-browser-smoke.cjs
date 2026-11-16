// Runs exclusively against controlled pages and a temporary database/profile.
/* global globalThis */
const { app, BrowserWindow, session } = require("electron");
const assert = require("node:assert/strict");
const path = require("node:path");
const { createHash } = require("node:crypto");
const { writeFileSync, mkdirSync } = require("node:fs");
const https = require("node:https");
const tlsFixture = require("./source-browser-tls.cjs");
const { X509Certificate } = require("node:crypto");
const fixturePort = Number(process.env.SOURCE_BROWSER_FIXTURE_PORT);
app.commandLine.appendSwitch(
  "host-resolver-rules",
  `MAP *.example 127.0.0.1:${fixturePort}, EXCLUDE localhost`
);
app.on(
  "certificate-error",
  (event, _contents, url, _error, certificate, callback) => {
    if (
      new URL(url).hostname.endsWith(".example") &&
      new X509Certificate(certificate.data).fingerprint256 ===
        new X509Certificate(tlsFixture.cert).fingerprint256
    ) {
      event.preventDefault();
      callback(true);
    } else callback(false);
  }
);
app.setPath("userData", path.join(__dirname, "user-data"));
app.disableHardwareAcceleration();
app.commandLine.appendSwitch("disable-renderer-backgrounding");
app.commandLine.appendSwitch("disable-backgrounding-occluded-windows");
app.commandLine.appendSwitch("disable-background-timer-throttling");
setTimeout(() => {
  console.error("Source browser integration checks timed out.");
  app.exit(1);
}, 90000).unref();
const wait = async (condition) => {
  const end = Date.now() + 15000;
  while (Date.now() < end) {
    const value = await condition();
    if (value) return value;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error("Timed out waiting for source browser fixture.");
};
const profile = {
  website: "https://fixture.example/",
  searchUrl: "https://fixture.example/?s={query}",
};
const sourceId = "controlled-source";
const partition = `persist:source-browser-${createHash("sha256").update(sourceId).digest("hex").slice(0, 24)}`;
const data = new Map([
  ["userPreferences", {}],
  ["sourceWebsiteProfiles", { [sourceId]: profile }],
]);
globalThis.sourceBrowserTestDb = {
  get: async (key) => data.get(key),
  put: async (key, value) => {
    data.set(key, value);
  },
};
globalThis.sourceBrowserTestParts = true;
const request = {
  shop: "steam",
  objectId: "123",
  gameTitle: "Fixture Game",
  repack: {
    id: "release",
    title: "Fixture Game v1",
    uris: [],
    unavailableUris: [],
    downloadSourceId: sourceId,
    downloadSourceName: "Controlled source",
    uploadDate: "2026-01-01",
    fileSize: "1 GB",
    createdAt: "",
  },
};
app
  .whenReady()
  .then(async () => {
    const owner = new BrowserWindow({ show: false });
    await owner.loadURL("data:text/html,Hydra test owner");
    globalThis.sourceBrowserTestWindows = {
      mainWindow: owner,
      bigPictureWindow: null,
    };
    const service = require("./main/service.cjs");
    const sender = {
      sender: owner.webContents,
      senderFrame: owner.webContents.mainFrame,
    };
    data.set("userPreferences", { enableSourceBrowser: false });
    assert.deepEqual(
      await service.getSourceWebsiteProfiles(),
      { [sourceId]: { ...profile, approvedDomains: ["fixture.example"] } },
      "Website profile management remains available while browsing is disabled"
    );
    await service.saveSourceWebsiteProfile(sourceId, profile);
    assert.deepEqual(
      data.get("sourceWebsiteProfiles"),
      { [sourceId]: { ...profile, approvedDomains: ["fixture.example"] } },
      "Saving a website profile does not require a source feed or enabled browsing"
    );
    await service.clearSourceWebsiteData(sourceId);
    await assert.rejects(
      service.openSourceBrowser(sender, request),
      /browsing is disabled/i,
      "The setting still prevents opening source websites"
    );
    data.set("userPreferences", { enableSourceBrowser: true });
    const siteSession = session.fromPartition(partition);
    const requests = [];
    const fixtureResponse = (req) => {
      requests.push({ url: req.url, method: req.method });
      if (new URL(req.url).pathname === "/fixture-game-redirect-unapproved")
        return new Response(null, {
          status: 302,
          headers: { location: "https://unapproved.example/redirect-target" },
        });
      if (new URL(req.url).pathname === "/fixture-game-redirect-post")
        return new Response(null, {
          status: 307,
          headers: { location: "https://unapproved.example/post-target" },
        });
      return new URL(req.url).pathname === "/embed"
        ? new Response("<p>Third-party comment fixture</p>", {
            headers: { "content-type": "text/html" },
          })
        : new URL(req.url).pathname === "/image"
          ? new Response(
              '<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"/>',
              { headers: { "content-type": "image/svg+xml" } }
            )
          : new URL(req.url).pathname === "/fixture-game-forbidden"
            ? new Response("Forbidden", {
                status: 403,
                headers: { "content-type": "text/html" },
              })
            : new URL(req.url).pathname === "/fixture-game-file"
              ? new Response("fixture", {
                  headers: {
                    "content-type": "application/octet-stream",
                    "content-disposition": "attachment; filename=fixture.bin",
                  },
                })
              : new URL(req.url).pathname === "/fixture-game-redirect"
                ? new Response(null, {
                    status: 302,
                    headers: {
                      location: "https://gofile.io/d/redirect-fixture",
                    },
                  })
                : new Response(
                    `<html><body><h1>Fixture release</h1><p>Comments: controlled test</p><img src="https://cdn.example/image"><iframe src="https://comments.example/embed"></iframe><a id="unapproved" href="https://unapproved.example/page">Unknown page</a><form id="post" action="https://unapproved.example/post" method="post"><input name="fixture" value="test"></form><a id="hoster" href="https://gofile.io/d/fixture">Download</a><a id="magnet" href="magnet:?xt=urn:btih:${"a".repeat(40)}">Magnet</a></body></html>`,
                    { headers: { "content-type": "text/html" } }
                  );
    };
    const server = https.createServer(tlsFixture, async (req, res) => {
      const result = fixtureResponse({
        url: `https://${req.headers.host}${req.url}`,
        method: req.method,
      });
      res.writeHead(result.status, Object.fromEntries(result.headers));
      res.end(Buffer.from(await result.arrayBuffer()));
    });
    await new Promise((resolve, reject) => {
      server.once("error", reject);
      server.listen(fixturePort, "127.0.0.1", resolve);
    });
    const open = async (value = request) => {
      await wait(() => BrowserWindow.getAllWindows().every((w) => w === owner));
      const result = service.openSourceBrowser(sender, value);
      void result.catch(() => {});
      const win = await wait(() =>
        BrowserWindow.getAllWindows().find((w) => w !== owner)
      );
      await wait(
        () =>
          win.webContents.getURL().includes("source-browser.html") &&
          !win.webContents.isLoading()
      );
      const api = (expression) => win.webContents.executeJavaScript(expression);
      await wait(() => api("Boolean(window.sourceBrowser)"));
      const state = () => api("window.sourceBrowser.state()");
      const command = (value) =>
        api(`window.sourceBrowser.command(${JSON.stringify(value)})`);
      const view = win.contentView.children[0];
      await wait(async () => {
        const snapshot = await state();
        return (
          snapshot.lookup === "setup" ||
          snapshot.blockedNavigation ||
          (snapshot.pageUrl && !view.webContents.isLoading())
        );
      });
      return { result, win, view, api, state, command };
    };
    let browser = await open();
    await wait(async () =>
      (await browser.state()).url.startsWith(profile.website)
    );
    assert.equal((await browser.state()).lookup, "search");
    assert.deepEqual(
      (await service.getSourceWebsiteProfiles())[sourceId].approvedDomains,
      ["fixture.example"]
    );
    assert.deepEqual(
      data.get("sourceWebsiteProfiles")[sourceId].approvedDomains,
      ["fixture.example"],
      "Saving a profile persists its validated website hostname"
    );
    await wait(
      () =>
        requests.some((entry) => entry.url === "https://cdn.example/image") &&
        requests.some((entry) => entry.url === "https://comments.example/embed")
    );
    assert.equal(
      await browser.api(
        "Boolean(document.getElementById('website') || document.getElementById('profile'))"
      ),
      false
    );
    await assert.rejects(
      browser.command({
        action: "profile",
        profile: {
          website: "https://unapproved.example/",
          searchUrl: "https://unapproved.example/?s={query}",
        },
      })
    );
    const verifyBlocked = async (action) => {
      const beforeRequests = requests.filter(
        (entry) => new URL(entry.url).hostname === "unapproved.example"
      ).length;
      await action();
      await wait(
        async () =>
          (await browser.state()).blockedNavigation?.hostname ===
          "unapproved.example"
      );
      assert.equal(
        requests.filter(
          (entry) => new URL(entry.url).hostname === "unapproved.example"
        ).length,
        beforeRequests
      );
      await browser.command({
        action: "navigate",
        url: "https://fixture.example/fixture-game-release",
      });
      await wait(
        async () =>
          (await browser.state()).url.endsWith("/fixture-game-release") &&
          !browser.view.webContents.isLoading()
      );
    };
    await verifyBlocked(() =>
      browser.command({
        action: "navigate",
        url: "https://unapproved.example/page",
      })
    );
    const unrelatedRequests = requests.length;
    await browser.command({
      action: "navigate",
      url: "https://fixture.example/f1-2015-free-download/",
    });
    await wait(
      async () =>
        (await browser.state()).blockedNavigation?.reason === "different-game"
    );
    assert.equal(
      requests.length,
      unrelatedRequests,
      "Unrelated game pages must be blocked before the network request"
    );
    await verifyBlocked(() =>
      browser.view.webContents.executeJavaScript(
        "document.getElementById('unapproved').click()"
      )
    );
    await verifyBlocked(() =>
      browser.view.webContents.executeJavaScript(
        "document.getElementById('post').submit()"
      )
    );
    await verifyBlocked(() =>
      browser.view.webContents.executeJavaScript(
        "location.href='https://unapproved.example/script-navigation'"
      )
    );
    await verifyBlocked(() =>
      browser.view.webContents
        .loadURL("https://unapproved.example/direct-load")
        .catch(() => {})
    );
    await verifyBlocked(() =>
      browser.command({
        action: "navigate",
        url: "https://fixture.example/fixture-game-redirect-unapproved",
      })
    );
    await verifyBlocked(() =>
      browser.view.webContents.executeJavaScript(
        "const form=document.getElementById('post');form.action='https://fixture.example/fixture-game-redirect-post';form.submit()"
      )
    );
    await browser.command({
      action: "navigate",
      url: "https://fixture.example/fixture-game-history",
    });
    await wait(async () =>
      (await browser.state()).url.endsWith("/fixture-game-history")
    );
    await browser.command({ action: "back" });
    await wait(async () =>
      (await browser.state()).url.endsWith("/fixture-game-release")
    );
    assert.equal(await browser.api("typeof window.electron"), "undefined");
    assert.equal(
      await browser.view.webContents.executeJavaScript(
        "typeof window.sourceBrowser + '/' + typeof window.electron + '/' + typeof require"
      ),
      "undefined/undefined/undefined"
    );
    const prefs = browser.view.webContents.getLastWebPreferences();
    assert.equal(prefs.sandbox, true);
    assert.equal(prefs.nodeIntegration, false);
    assert.equal(prefs.contextIsolation, true);
    assert.doesNotMatch(browser.view.webContents.getUserAgent(), /Electron\//);
    assert.throws(() =>
      service.assertSourceBrowserOwner({
        sender: browser.view.webContents,
        senderFrame: browser.view.webContents.mainFrame,
      })
    );
    await browser.view.webContents.executeJavaScript(
      "document.getElementById('hoster').click()"
    );
    await wait(async () => (await browser.state()).links.length === 1);
    await browser.command({
      action: "add",
      url: "https://gofile.io/d/fixture",
    });
    assert.equal((await browser.state()).links.length, 1);
    await assert.rejects(
      browser.command({
        action: "add",
        url: "https://gofile.io.evil.example/fixture-game-file",
      })
    );
    await assert.rejects(
      browser.command({
        action: "review",
        mode: "single",
        releaseTitle: request.repack.title,
        acknowledged: false,
      })
    );
    await wait(() =>
      browser.api("document.getElementById('count').textContent === '1'")
    );
    const blockedDownload = new Promise((resolve) =>
      siteSession.once("will-download", (event) =>
        resolve(event.defaultPrevented)
      )
    );
    await browser.view.webContents.executeJavaScript(
      `const fileLink = document.createElement('a'); fileLink.href='https://fixture.example/fixture-game-file'; document.body.append(fileLink); fileLink.click();`
    );
    assert.equal(await blockedDownload, true);
    await wait(async () =>
      (await browser.state()).error.includes(
        "Browser file downloads are blocked"
      )
    );
    await browser.command({
      action: "navigate",
      url: "https://fixture.example/fixture-game-forbidden",
    });
    await wait(async () => (await browser.state()).error.includes("HTTP 403"));
    await wait(() =>
      browser.api(
        "document.getElementById('status').textContent.includes('HTTP 403')"
      )
    );
    await browser.command({
      action: "navigate",
      url: "https://fixture.example/fixture-game-release",
    });
    await wait(
      async () =>
        (await browser.state()).url.endsWith("/fixture-game-release") &&
        !(await browser.state()).error
    );
    const shot = await browser.win.capturePage(undefined, {
      stayHidden: true,
      stayAwake: true,
    });
    mkdirSync(path.join(__dirname, "screenshots"), { recursive: true });
    writeFileSync(
      path.join(__dirname, "screenshots/browser.png"),
      shot.toPNG()
    );
    await browser.command({
      action: "add",
      url: "https://gofile.io/d/fixture",
    });
    void browser
      .command({
        action: "review",
        mode: "single",
        releaseTitle: request.repack.title,
        acknowledged: true,
      })
      .catch(() => {});
    const selection = await browser.result;
    assert.equal(selection.downloadSourceId, sourceId);
    assert.deepEqual(selection.uris, ["https://gofile.io/d/fixture"]);
    assert.match(selection.sourcePageUrl, /^https:\/\/fixture.example\//);
    browser = await open();
    await wait(async () =>
      (await browser.state()).url.startsWith(profile.website)
    );
    await browser.command({
      action: "navigate",
      url: "https://fixture.example/fixture-game-release",
    });
    await wait(async () =>
      (await browser.state()).url.endsWith("/fixture-game-release")
    );
    await browser.command({
      action: "navigate",
      url: "https://fixture.example/fixture-game-redirect",
    });
    await wait(async () =>
      (await browser.state()).links.includes(
        "https://gofile.io/d/redirect-fixture"
      )
    );
    await browser.command({ action: "remove", index: 0 });
    await browser.view.webContents.executeJavaScript(
      `window.open('https://gofile.io/d/popup', '_blank')`
    );
    await wait(async () =>
      (await browser.state()).links.includes("https://gofile.io/d/popup")
    );
    await browser.command({
      action: "add",
      url: "https://gofile.io/d/other-mirror",
    });
    void browser
      .command({
        action: "review",
        mode: "mirrors",
        mirrorIndex: 1,
        releaseTitle: "Fixture Game v2",
        acknowledged: true,
      })
      .catch(() => {});
    const mirrorSelection = await browser.result;
    assert.deepEqual(mirrorSelection.uris, [
      "https://gofile.io/d/other-mirror",
    ]);
    assert.equal(mirrorSelection.fileSize, null);
    browser = await open({
      ...request,
      repack: {
        ...request.repack,
        sourcePageUrl: "https://fixture.example/fixture-game-release",
      },
    });
    await wait(async () => (await browser.state()).lookup === "exact");
    await browser.command({ action: "add", url: "https://gofile.io/d/part1" });
    await browser.command({ action: "add", url: "https://gofile.io/d/part2" });
    await browser.command({ action: "up", index: 1 });
    globalThis.sourceBrowserTestParts = false;
    await assert.rejects(
      browser.command({
        action: "review",
        mode: "parts",
        releaseTitle: request.repack.title,
        acknowledged: true,
      })
    );
    globalThis.sourceBrowserTestParts = true;
    void browser
      .command({
        action: "review",
        mode: "parts",
        releaseTitle: request.repack.title,
        acknowledged: true,
      })
      .catch(() => {});
    assert.deepEqual((await browser.result).uriGroups, [
      ["https://gofile.io/d/part2", "https://gofile.io/d/part1"],
    ]);
    browser = await open();
    data.set("userPreferences", { enableSourceBrowser: false });
    await assert.rejects(
      browser.command({ action: "add", url: "https://gofile.io/d/blocked" })
    );
    service.closeSourceBrowsers();
    assert.equal(await browser.result, null);
    await assert.rejects(service.openSourceBrowser(sender, request));
    data.set("userPreferences", {});
    browser = await open({ ...request, readOnly: true });
    await assert.rejects(
      browser.command({
        action: "review",
        mode: "single",
        releaseTitle: request.repack.title,
        acknowledged: true,
      })
    );
    void browser.command({ action: "close" }).catch(() => {});
    assert.equal(await browser.result, null);
    browser = await open({
      ...request,
      repack: {
        ...request.repack,
        sourcePageUrl: "https://unapproved.example/catalogue-supplied",
      },
    });
    assert.equal(
      (await browser.state()).blockedNavigation.hostname,
      "unapproved.example"
    );
    assert.equal(
      requests.some(
        (entry) => new URL(entry.url).hostname === "unapproved.example"
      ),
      false
    );
    void browser.command({ action: "close" }).catch(() => {});
    await browser.result;
    browser = await open({
      ...request,
      repack: {
        ...request.repack,
        downloadSourceId: "unconfigured-source",
        sourcePageUrl: "https://unapproved.example/no-profile",
      },
    });
    assert.equal((await browser.state()).lookup, "setup");
    assert.equal(
      (await browser.state()).blockedNavigation.reason,
      "profile-required"
    );
    void browser.command({ action: "close" }).catch(() => {});
    await browser.result;
    await service.saveSourceWebsiteProfile(sourceId, {
      ...profile,
      approvedDomains: ["unapproved.example"],
    });
    browser = await open();
    await browser.command({
      action: "navigate",
      url: "https://unapproved.example/fixture-game-explicit-exception",
    });
    await wait(async () =>
      (await browser.state()).url.includes("unapproved.example")
    );
    await service.saveSourceWebsiteProfile(sourceId, profile);
    assert.equal(await browser.result, null);
    browser = await open();
    await verifyBlocked(() =>
      browser.command({
        action: "navigate",
        url: "https://unapproved.example/removed-exception",
      })
    );
    // A second owner shares this source's session. Both views must retain gates.
    const owner2 = new BrowserWindow({ show: false });
    await owner2.loadURL("data:text/html,second-owner");
    globalThis.sourceBrowserTestWindows.bigPictureWindow = owner2;
    const before = new Set(BrowserWindow.getAllWindows());
    const secondResult = service.openSourceBrowser(
      { sender: owner2.webContents, senderFrame: owner2.webContents.mainFrame },
      request
    );
    const secondWindow = await wait(() =>
      BrowserWindow.getAllWindows().find((w) => !before.has(w))
    );
    await wait(
      () =>
        secondWindow.webContents.getURL().includes("source-browser.html") &&
        !secondWindow.webContents.isLoading()
    );
    const secondView = secondWindow.contentView.children[0];
    await wait(
      () =>
        secondView.webContents.getURL().startsWith(profile.website) &&
        !secondView.webContents.isLoading()
    );
    await browser.command({
      action: "navigate",
      url: "https://fixture.example/fixture-game-still-approved",
    });
    await wait(async () =>
      (await browser.state()).url.endsWith("/fixture-game-still-approved")
    );
    await browser.view.webContents
      .loadURL("https://unapproved.example/first-owner")
      .catch(() => {});
    await wait(
      async () =>
        (await browser.state()).blockedNavigation?.hostname ===
        "unapproved.example"
    );
    await secondView.webContents
      .loadURL("https://unapproved.example/second-owner")
      .catch(() => {});
    await wait(() =>
      secondWindow.webContents.executeJavaScript(
        "window.sourceBrowser.state().then(s=>s.blockedNavigation?.hostname==='unapproved.example')"
      )
    );
    assert.equal(
      requests.filter((e) => new URL(e.url).hostname === "unapproved.example")
        .length,
      1
    );
    await service.saveSourceWebsiteProfile(sourceId, profile);
    assert.equal(await browser.result, null);
    assert.equal(await secondResult, null);
    owner2.destroy();
    globalThis.sourceBrowserTestWindows.bigPictureWindow = null;
    await siteSession.cookies.set({
      url: profile.website,
      name: "fixture",
      value: "cookie",
    });
    const otherSession = session.fromPartition(
      "persist:source-browser-fixture-other-source"
    );
    await otherSession.cookies.set({
      url: profile.website,
      name: "other-fixture",
      value: "kept",
    });
    await service.clearSourceWebsiteData(sourceId);
    assert.equal(
      (await siteSession.cookies.get({ url: profile.website })).length,
      0
    );
    assert.equal(
      (await otherSession.cookies.get({ url: profile.website })).length,
      1
    );
    await otherSession.clearStorageData();
    // No download-source feed exists in this fixture database. A standalone
    // profile must still search and return links only after explicit review.
    const independentId = "website:independent";
    await service.saveSourceWebsiteProfile(independentId, {
      ...profile,
      name: "Independent website",
    });
    browser = await open({
      ...request,
      repack: {
        ...request.repack,
        id: "website-search:independent",
        sourceOrigin: "website",
        title: request.gameTitle,
        downloadSourceId: independentId,
        downloadSourceName: "Independent website",
        fileSize: null,
        uploadDate: null,
      },
    });
    assert.equal((await browser.state()).lookup, "search");
    assert.equal(
      new URL((await browser.state()).url).searchParams.get("s"),
      request.gameTitle
    );
    await browser.command({
      action: "navigate",
      url: "https://fixture.example/fixture-game-release",
    });
    await wait(
      async () =>
        (await browser.state()).pageUrl.endsWith("/fixture-game-release") &&
        !browser.view.webContents.isLoading()
    );
    await browser.command({
      action: "add",
      url: "https://gofile.io/d/independent",
    });
    void browser
      .command({
        action: "review",
        mode: "single",
        releaseTitle: "Fixture Game v2",
        acknowledged: true,
      })
      .catch(() => {});
    const independentSelection = await browser.result;
    assert.equal(independentSelection.downloadSourceId, independentId);
    assert.equal(
      independentSelection.downloadSourceName,
      "Independent website"
    );
    assert.deepEqual(independentSelection.uris, [
      "https://gofile.io/d/independent",
    ]);
    assert.equal(independentSelection.fileSize, null);
    assert.equal(data.has("downloadSources"), false);
    owner.destroy();
    console.log("Source browser Electron integration checks passed.");
    app.exit(0);
  })
  .catch((error) => {
    console.error(error);
    app.exit(1);
  });
