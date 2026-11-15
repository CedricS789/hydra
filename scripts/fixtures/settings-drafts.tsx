/* eslint-disable @typescript-eslint/no-explicit-any -- Synthetic bridge and deliberately partial fixtures. */
import assert from "node:assert/strict";
import { test } from "node:test";
import { JSDOM } from "jsdom";
import { act, StrictMode, useState } from "react";
import { createRoot } from "react-dom/client";
import { createMemoryRouter, RouterProvider } from "react-router-dom";
import {
  SettingsDraftProvider,
  useSettingsDraft,
  useSettingsFormGuard,
  useSettingsProfile,
} from "../../src/renderer/src/context/settings/settings-draft.context";
import {
  changedSettings,
  reviewSettings,
} from "../../src/shared/settings-changes";

const dom = new JSDOM("<!doctype html><body><div id='root'></div></body>", {
  url: "https://launcher.example",
});
Object.assign(globalThis, {
  window: dom.window,
  document: dom.window.document,
  HTMLElement: dom.window.HTMLElement,
  IS_REACT_ACT_ENVIRONMENT: true,
});

test("settings drafts: explicit saves, cancellation, failures, conflicts, profile privacy and navigation", async () => {
  let preferences: any = {
    runAtStartup: false,
    seedAfterDownloadComplete: false,
    language: "en",
  };
  let profile: any = { id: "account-1", profileVisibility: "PRIVATE" };
  let onUpdated = (_value: unknown) => {};
  const writes: any[] = [];
  const profileWrites: any[] = [];
  const reviews: { kind: string; changes: string[] }[] = [];
  let accept = true,
    fail = false;
  Object.assign(window, {
    electron: {
      getUserPreferences: async () => ({ ...preferences }),
      onUserPreferencesUpdated: (cb: any) => {
        onUpdated = cb;
        return () => {};
      },
      updateUserPreferences: async (patch: any) => {
        if (fail) throw Error("Disk write failed");
        writes.push(patch);
        preferences = { ...preferences, ...patch };
        onUpdated({ ...preferences });
      },
      confirmSettingsChanges: async (kind: string, changes: string[]) => {
        reviews.push({ kind, changes });
        return accept;
      },
      getMe: async () => ({ ...profile }),
    },
  });
  let editor: any;
  function Form() {
    const [dirty, setDirty] = useState(false);
    useSettingsFormGuard("local-rules", dirty, "Local save rules");
    return <button onClick={() => setDirty(true)}>Edit local rules</button>;
  }
  function Editor() {
    const draft = useSettingsDraft()!;
    const account = useSettingsProfile({
      userDetails: profile,
      patchUser: async (patch: any) => {
        profileWrites.push(patch);
        profile = { ...profile, ...patch };
      },
    });
    editor = { ...draft, account };
    return <Form key={draft.revision} />;
  }
  const router = createMemoryRouter(
    [
      {
        path: "/settings",
        element: (
          <SettingsDraftProvider>
            <Editor />
          </SettingsDraftProvider>
        ),
      },
      { path: "/other", element: <p>Other page</p> },
    ],
    { initialEntries: ["/settings"] }
  );
  const root = createRoot(document.getElementById("root")!);
  const flush = async () => {
    await new Promise((resolve) => setTimeout(resolve, 10));
  };
  const click = async (label: string) => {
    await act(async () => {
      const button = [...document.querySelectorAll("button")].find(
        (b) => b.textContent === label
      )!;
      assert.ok(button, `Button ${label} exists`);
      assert.equal(button.disabled, false, `Button ${label} enabled`);
      button.click();
      await flush();
    });
  };
  const stage = async (patch: any) => {
    await act(async () => {
      await editor.stage(patch);
      await flush();
    });
  };
  await act(async () => {
    root.render(
      <StrictMode>
        <RouterProvider router={router} />
      </StrictMode>
    );
    await flush();
  });
  try {
    await stage({ runAtStartup: true });
    assert.equal(writes.length, 0, "Editing does not write to backend");
    accept = false;
    await click("Save changes");
    assert.equal(writes.length, 0, "Canceled save does not write");
    assert.equal(
      editor.preferences.runAtStartup,
      true,
      "Canceled save keeps edits"
    );
    accept = true;
    await click("Save changes");
    assert.deepEqual(writes, [{ runAtStartup: true }]);
    assert.match(document.body.textContent!, /Settings saved/);

    await stage({ language: "fr" });
    fail = true;
    await click("Save changes");
    assert.equal(
      editor.preferences.language,
      "fr",
      "Failed save retains draft"
    );
    assert.match(document.body.textContent!, /Disk write failed/);
    fail = false;
    await click("Discard edits");
    assert.equal(
      editor.preferences.language,
      "en",
      "Discard restores saved values"
    );

    await stage({ language: "fr" });
    accept = false;
    await act(async () => {
      await router.navigate("/other");
      await flush();
    });
    assert.equal(
      router.state.location.pathname,
      "/settings",
      "Canceled navigation stays on Settings"
    );
    assert.equal(editor.preferences.language, "fr");
    accept = true;
    await act(async () => {
      await router.navigate("/other");
      await flush();
    });
    assert.equal(
      router.state.location.pathname,
      "/other",
      "Confirmed discard allows navigation"
    );
    assert.equal(preferences.language, "en");
    await act(async () => {
      await router.navigate("/settings");
      await flush();
    });

    await stage({ language: "fr" });
    preferences.language = "de";
    await act(async () => {
      onUpdated({ ...preferences });
      await flush();
    });
    const count = writes.length;
    await click("Save changes");
    assert.equal(
      writes.length,
      count,
      "Concurrent changes are not overwritten"
    );
    assert.match(document.body.textContent!, /another window/);
    await click("Discard edits");
    assert.equal(editor.preferences.language, "de");

    await act(async () => {
      await editor.account.patchUser({ profileVisibility: "PUBLIC" });
      await flush();
    });
    assert.equal(profileWrites.length, 0, "Privacy edit is staged");
    assert.equal(profile.profileVisibility, "PRIVATE");
    accept = false;
    await click("Save changes");
    assert.equal(profileWrites.length, 0);
    accept = true;
    await click("Save changes");
    assert.deepEqual(profileWrites, [{ profileVisibility: "PUBLIC" }]);

    await click("Edit local rules");
    await stage({ language: "fr" });
    assert.equal(
      document.querySelector<HTMLButtonElement>("button:last-child")?.disabled,
      true,
      "Own-save section edits must be resolved before applying other preferences"
    );
    accept = false;
    let left = false;
    await act(async () => {
      await editor.guardNavigation(() => {
        left = true;
      });
      await flush();
    });
    assert.equal(left, false, "Own-save forms block category navigation");
    accept = true;
    await click("Discard edits");
    assert.match(
      document.body.textContent!,
      /Changes take effect only after saving/
    );

    await stage({ language: "fr" });
    await stage({ language: "de" });
    assert.equal(
      document.querySelector<HTMLButtonElement>("button:last-child")?.disabled,
      true,
      "Reverting a field clears its draft"
    );
    assert.ok(reviews.some((review) => review.kind === "save"));
    assert.ok(reviews.some((review) => review.kind === "discard"));
    accept = false;
    await act(async () => {
      await assert.rejects(
        editor.commit({ realDebridApiToken: "never-display-this" }),
        /not saved/
      );
      await flush();
    });
    assert.ok(
      !reviews.at(-1)!.changes.join(" ").includes("never-display-this")
    );
    assert.equal(
      writes.length,
      count,
      "Canceling an own-save commit does not write preferences"
    );
    await stage({ language: "fr" });
    await act(async () => {
      editor.markOperation("provider-check", true);
      await flush();
    });
    let operationNavigation = false;
    await act(async () => {
      await editor.guardNavigation(() => {
        operationNavigation = true;
      });
      await flush();
    });
    assert.equal(
      operationNavigation,
      false,
      "Leaving is blocked during a section save"
    );
    assert.equal(
      document.querySelector<HTMLButtonElement>("button:last-child")?.disabled,
      true
    );
    await act(async () => {
      editor.markOperation("provider-check", false);
      await flush();
    });
    const closeEvent = new dom.window.Event("beforeunload", {
      cancelable: true,
    });
    await act(async () => {
      window.dispatchEvent(closeEvent);
      await flush();
    });
    assert.equal(
      closeEvent.defaultPrevented,
      true,
      "Closing with unsaved edits is intercepted"
    );
    assert.equal(
      editor.preferences.language,
      "fr",
      "Canceled close retains edits"
    );
    let closed = false;
    window.close = () => {
      closed = true;
    };
    accept = true;
    await act(async () => {
      window.dispatchEvent(
        new dom.window.Event("beforeunload", { cancelable: true })
      );
      await flush();
    });
    assert.equal(closed, true, "Confirmed discard permits closing");
    assert.equal(preferences.language, "de");
  } finally {
    await act(async () => {
      root.unmount();
    });
    router.dispose();
  }
});

test("review hides token values and compares only changed fields", () => {
  const secret = "not-for-review-token";
  assert.deepEqual(
    changedSettings(
      { runAtStartup: true },
      { runAtStartup: true, language: "fr" }
    ),
    { language: "fr" }
  );
  assert.deepEqual(
    changedSettings(
      { screenshotGamepadCombo: ["a"] as any },
      { screenshotGamepadCombo: ["a"] as any }
    ),
    {}
  );
  assert.ok(
    !reviewSettings({ realDebridApiToken: secret }).join(" ").includes(secret)
  );
  assert.match(
    reviewSettings({ allowDirectTorrent: true }).join(" "),
    /public IP/
  );
});
