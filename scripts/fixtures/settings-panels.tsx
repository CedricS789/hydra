/* eslint-disable @typescript-eslint/no-explicit-any -- Isolated Electron bridge fixtures. */
import assert from "node:assert/strict";
import { test } from "node:test";
import { JSDOM } from "jsdom";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { createMemoryRouter, RouterProvider } from "react-router-dom";
import { SettingsDraftProvider } from "../../src/renderer/src/context/settings/settings-draft.context";
import { SettingsContextGeneral } from "../../src/renderer/src/pages/settings/settings-context-general";
import { SettingsLudusaviAdvanced } from "../../src/renderer/src/pages/settings/settings-ludusavi-advanced";

test("real settings panels defer startup changes and require explicit backup saves", async () => {
  const dom = new JSDOM("<!doctype html><body><div id='root'></div></body>", {
    url: "https://launcher.example",
  });
  Object.assign(globalThis, {
    window: dom.window,
    document: dom.window.document,
    HTMLElement: dom.window.HTMLElement,
    IS_REACT_ACT_ENVIRONMENT: true,
  });
  const fixture = {
    preferences: { runAtStartup: false, language: "en" },
    backupState: {
      settings: {
        enabled: true,
        destination: "C:/fixture/backups",
        fullRetention: 10,
        differentialRetention: 0,
        format: "zip",
        compression: "deflate",
        exitDelaySeconds: 10,
        games: {},
      },
      games: [],
      history: [],
      busy: false,
      bulkProgress: { running: false },
    },
    beforeManagerAction: undefined as undefined | (() => Promise<void>),
  };
  (globalThis as any).__settingsPanels = fixture;
  let accept = false,
    startupCalls = 0,
    listener = (_value: any) => {};
  const preferenceWrites: any[] = [],
    backupWrites: any[] = [];
  Object.assign(window, {
    electron: {
      platform: "win32",
      isPortableVersion: false,
      getUserPreferences: async () => ({ ...fixture.preferences }),
      onUserPreferencesUpdated: (cb: any) => {
        listener = cb;
        return () => {};
      },
      getDefaultDownloadsPath: async () => "C:/fixture/downloads",
      autoLaunch: async () => {
        startupCalls++;
      },
      updateUserPreferences: async (patch: any) => {
        preferenceWrites.push(patch);
        fixture.preferences = { ...fixture.preferences, ...patch };
        listener({ ...fixture.preferences });
      },
      getLudusaviLocalState: async () => fixture.backupState,
      saveLudusaviLocalSettings: async (settings: any) => {
        backupWrites.push(settings);
        fixture.backupState = { ...fixture.backupState, settings };
        return fixture.backupState;
      },
    },
  });
  const router = createMemoryRouter(
    [
      {
        path: "/general",
        element: (
          <SettingsDraftProvider confirmationOverride={async () => accept}>
            <SettingsContextGeneral
              appearance={{ theme: null, authorId: null, authorName: null }}
            />
          </SettingsDraftProvider>
        ),
      },
      {
        path: "/advanced",
        element: (
          <SettingsDraftProvider confirmationOverride={async () => accept}>
            <SettingsLudusaviAdvanced />
          </SettingsDraftProvider>
        ),
      },
    ],
    { initialEntries: ["/general"] }
  );
  const root = createRoot(document.getElementById("root")!);
  const flush = async () => {
    await new Promise((resolve) => setTimeout(resolve, 10));
  };
  const clickButton = async (text: string) => {
    await act(async () => {
      const button = [...document.querySelectorAll("button")].find(
        (el) => el.textContent === text
      )!;
      assert.ok(button, text);
      assert.equal(button.disabled, false, text);
      button.click();
      await flush();
    });
  };
  const clickCheckbox = async (label: string) => {
    await act(async () => {
      const el = [...document.querySelectorAll("label")]
        .find((el) => el.textContent === label)
        ?.querySelector<HTMLInputElement>("input[type=checkbox]");
      assert.ok(el, label);
      el.click();
      await flush();
    });
  };
  await act(async () => {
    root.render(<RouterProvider router={router} />);
    await flush();
  });
  try {
    await clickCheckbox("launch_with_system");
    assert.equal(preferenceWrites.length, 0);
    assert.equal(
      startupCalls,
      0,
      "Startup registration is not changed by editing the checkbox"
    );
    await clickButton("Save changes");
    assert.equal(
      preferenceWrites.length,
      0,
      "Canceling general settings save leaves preferences unchanged"
    );
    accept = true;
    await clickButton("Save changes");
    assert.equal(preferenceWrites[0].runAtStartup, true);
    await act(async () => {
      await router.navigate("/advanced");
      await flush();
    });
    await clickCheckbox("enable");
    await clickCheckbox("confirm_disable_global_acknowledgement");
    await clickButton("confirm_disable_backups");
    assert.equal(
      backupWrites.length,
      0,
      "Acknowledging a disable request only stages the edit"
    );
    assert.equal(
      fixture.backupState.settings.enabled,
      true,
      "Automatic backups remain enabled until explicitly saved"
    );
    await assert.rejects(fixture.beforeManagerAction!(), /Save or discard/);
    assert.equal(
      backupWrites.length,
      0,
      "Manager actions cannot silently save pending rules"
    );
    accept = false;
    await clickButton("Save backup settings");
    assert.equal(
      backupWrites.length,
      0,
      "Canceling the backup review keeps live settings unchanged"
    );
    accept = true;
    await clickButton("Save backup settings");
    assert.equal(backupWrites.length, 1);
    assert.equal(backupWrites[0].enabled, false);
    await fixture.beforeManagerAction!();
  } finally {
    await act(async () => root.unmount());
    router.dispose();
    delete (globalThis as any).__settingsPanels;
  }
});
