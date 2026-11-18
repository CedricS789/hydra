import assert from "node:assert/strict";
import { test } from "node:test";
import { JSDOM } from "jsdom";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { SourceWebsiteSearch } from "../../src/renderer/src/components/source-website-search";
import { SourceBrowserButton } from "../../src/renderer/src/components/source-browser-button";
import { sourceBrowserRequestKey } from "../../src/shared/source-browser-policy";
import type { GameRepack } from "../../src/types";
import type { SourceBrowserRequest } from "../../src/types/source-browser.types";

test("empty picker: standalone profiles, review, cancellation, failures and disabled browsing", async () => {
  const dom = new JSDOM("<div id='root'></div>", {
    url: "https://launcher.example",
  });
  Object.assign(globalThis, {
    window: dom.window,
    document: dom.window.document,
    IS_REACT_ACT_ENVIRONMENT: true,
  });
  const profiles = {
    "website:fixture": {
      name: "Fixture website",
      website: "https://fixture.example/",
      searchUrl: "https://fixture.example/?s={query}",
    },
  };
  let available = false,
    fail = false;
  let request: SourceBrowserRequest | undefined;
  let result: GameRepack | null = null;
  const reviewed: GameRepack[] = [];
  let settings = 0;
  Object.assign(window, {
    electron: {
      getSourceWebsiteProfiles: async () => {
        if (fail) throw Error("Profile read failed");
        return available ? profiles : {};
      },
      getUserPreferences: async () => ({}),
      openSourceBrowser: async (value: SourceBrowserRequest) => {
        request = value;
        return result;
      },
    },
  });
  const root = createRoot(document.getElementById("root")!);
  const render = async (enabled = true, objectId = "42") =>
    act(async () =>
      root.render(
        <SourceWebsiteSearch
          enabled={enabled}
          shop="steam"
          objectId={objectId}
          gameTitle="Fixture Game"
          onReview={(value) => reviewed.push(value)}
          onSettings={() => settings++}
          renderButton={({ id, label, hostname: _hostname, ...props }) => (
            <button key={id} id={id} {...props}>
              {label}
            </button>
          )}
        />
      )
    );
  const click = async (id: string) =>
    act(async () => {
      (document.getElementById(id) as HTMLButtonElement).click();
    });
  await render();
  assert.equal(request, undefined);
  assert.match(document.body.textContent!, /Search on/);
  assert.match(document.body.textContent!, /No websites configured\./);
  assert.equal(document.querySelectorAll("#configure-websites").length, 1);
  await click("configure-websites");
  assert.equal(settings, 1);
  fail = true;
  await render(true, "43");
  assert.match(
    document.querySelector('[role="alert"]')!.textContent!,
    /Profile read failed/
  );
  assert.equal(document.querySelectorAll("#configure-websites").length, 1);
  fail = false;
  available = true;
  await render(true, "44");
  const websiteButton = document.getElementById(
    "search-website-website:fixture"
  ) as HTMLButtonElement;
  assert.equal(websiteButton.textContent, "Fixture website");
  assert.doesNotMatch(websiteButton.textContent ?? "", /Search on/);
  await click("search-website-website:fixture");
  assert.equal(request!.gameTitle, "Fixture Game");
  assert.equal(request!.objectId, "44");
  assert.equal(request!.repack.downloadSourceId, "website:fixture");
  assert.deepEqual(request!.repack.uris, []);
  assert.equal(reviewed.length, 0); // Closing browser starts nothing.
  result = {
    ...request!.repack,
    title: "Fixture Game v2",
    uris: ["https://gofile.io/d/fixture"],
  };
  await click("search-website-website:fixture");
  assert.deepEqual(reviewed, [result]);
  await render(false);
  assert.equal(document.querySelector("button"), null);
  await act(async () => root.unmount());
  dom.window.close();
});

test("clears Opening state per button once the browser window opens", async () => {
  const dom = new JSDOM("<div id='root'></div>", {
    url: "https://launcher.example",
  });
  Object.assign(globalThis, {
    window: dom.window,
    document: dom.window.document,
    IS_REACT_ACT_ENVIRONMENT: true,
  });
  const profiles = {
    "website:first": {
      name: "First site",
      website: "https://first.example/",
      searchUrl: "https://first.example/?s={query}",
    },
    "website:second": {
      name: "Second site",
      website: "https://second.example/",
      searchUrl: "https://second.example/?s={query}",
    },
  };
  const openedListeners = new Set<(requestKey: string) => void>();
  const notifyOpened = (requestKey: string) => {
    for (const listener of openedListeners) listener(requestKey);
  };
  let resolveBrowser: ((repack: GameRepack | null) => void) | undefined;
  let pendingRequest: SourceBrowserRequest | undefined;
  const reviewed: GameRepack[] = [];
  Object.assign(window, {
    electron: {
      getSourceWebsiteProfiles: async () => profiles,
      getUserPreferences: async () => ({
        sourceWebsiteSearchOrder: ["website:first", "website:second"],
      }),
      openSourceBrowser: (value: SourceBrowserRequest) => {
        pendingRequest = value;
        return new Promise<GameRepack | null>((resolve) => {
          resolveBrowser = resolve;
        });
      },
      onSourceBrowserOpened: (listener: (requestKey: string) => void) => {
        openedListeners.add(listener);
        return () => {
          openedListeners.delete(listener);
        };
      },
    },
  });
  const root = createRoot(document.getElementById("root")!);
  await act(async () => {
    root.render(
      <>
        <SourceWebsiteSearch
          enabled
          shop="steam"
          objectId="99"
          gameTitle="Test Game"
          onReview={(value) => reviewed.push(value)}
          renderButton={({ id, label, hostname: _hostname, ...props }) => (
            <button key={id} id={id} {...props}>
              {label}
            </button>
          )}
        />
        <SourceBrowserButton
          enabled
          label="View source page"
          request={{
            shop: "steam",
            objectId: "99",
            gameTitle: "Test Game",
            readOnly: true,
            websiteProfileId: "website:first",
            repack: {
              id: "r1",
              title: "Test Game Release",
              uris: [],
              unavailableUris: [],
              downloadSourceId: "website:first",
              downloadSourceName: "First site",
              sourcePageUrl: "https://first.example/test-game",
              uploadDate: null,
              createdAt: "",
            },
          }}
          onReview={() => {}}
          renderTrigger={({ children, ...props }) => (
            <button id="view-source-btn" {...props}>
              {children}
            </button>
          )}
        />
      </>
    );
  });

  const firstBtn = document.getElementById(
    "search-website-website:first"
  ) as HTMLButtonElement;
  const secondBtn = document.getElementById(
    "search-website-website:second"
  ) as HTMLButtonElement;
  const viewBtn = document.getElementById(
    "view-source-btn"
  ) as HTMLButtonElement;

  assert.equal(firstBtn.textContent, "First site");
  assert.equal(secondBtn.textContent, "Second site");
  assert.equal(viewBtn.textContent, "View source page");

  // Click only First site: only First site shows "Opening ..." while window is opening.
  await act(async () => {
    firstBtn.click();
  });
  assert.equal(firstBtn.textContent, "Opening First site…");
  assert.equal(firstBtn.disabled, true);
  assert.equal(secondBtn.textContent, "Second site");
  assert.equal(secondBtn.disabled, false);

  // Simulate main signalling the browser window has opened while openSourceBrowser is still pending.
  await act(async () => {
    notifyOpened(sourceBrowserRequestKey(pendingRequest!));
  });
  assert.equal(firstBtn.textContent, "First site");
  assert.equal(firstBtn.disabled, false);

  // Later, user submits a selection from the still-open browser window.
  const selection: GameRepack = {
    ...pendingRequest!.repack,
    title: "Test Game Selected",
    uris: ["https://gofile.io/d/test"],
  };
  await act(async () => {
    resolveBrowser!(selection);
  });
  assert.deepEqual(reviewed, [selection]);

  // Verify SourceBrowserButton also clears "Opening website…" when window opens.
  await act(async () => {
    viewBtn.click();
  });
  assert.equal(viewBtn.textContent, "Opening website…");
  assert.equal(viewBtn.disabled, true);
  await act(async () => {
    notifyOpened(sourceBrowserRequestKey(pendingRequest!));
  });
  assert.equal(viewBtn.textContent, "View source page");
  assert.equal(viewBtn.disabled, false);
  await act(async () => {
    resolveBrowser!(null);
  });

  await act(async () => root.unmount());
  dom.window.close();
});
