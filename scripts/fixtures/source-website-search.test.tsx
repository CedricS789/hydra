import assert from "node:assert/strict";
import { test } from "node:test";
import { JSDOM } from "jsdom";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { SourceWebsiteSearch } from "../../src/renderer/src/components/source-website-search";
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
      openSourceBrowser: async (value: SourceBrowserRequest) => {
        request = value;
        return result;
      },
    },
  });
  const root = createRoot(document.getElementById("root")!);
  const render = async (enabled = true) =>
    act(async () =>
      root.render(
        <SourceWebsiteSearch
          enabled={enabled}
          shop="steam"
          objectId="42"
          gameTitle="Fixture Game"
          onReview={(value) => reviewed.push(value)}
          onSettings={() => settings++}
          renderButton={({ id, label, ...props }) => (
            <button id={id} {...props}>
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
  await click("search-websites");
  assert.match(document.body.textContent!, /No source websites configured/);
  await click("configure-websites");
  assert.equal(settings, 1);
  await click("close-websites");
  fail = true;
  await click("search-websites");
  assert.match(
    document.querySelector('[role="alert"]')!.textContent!,
    /Profile read failed/
  );
  fail = false;
  available = true;
  await click("search-websites");
  await click("search-website-website:fixture");
  assert.equal(request!.gameTitle, "Fixture Game");
  assert.equal(request!.objectId, "42");
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
  assert.equal(document.getElementById("search-website-website:fixture"), null);
  await render(false);
  assert.equal(document.querySelector("button"), null);
  await act(async () => root.unmount());
  dom.window.close();
});
