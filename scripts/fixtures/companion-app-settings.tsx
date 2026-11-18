/* eslint-disable @typescript-eslint/no-explicit-any -- Isolated Electron bridge fixture. */
import assert from "node:assert/strict";
import { test } from "node:test";
import { JSDOM } from "jsdom";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { createMemoryRouter, RouterProvider } from "react-router-dom";
import {
  SettingsDraftProvider,
  useSettingsDraft,
} from "../../src/renderer/src/context/settings/settings-draft.context";
import { SettingsCompanionApps } from "../../src/renderer/src/pages/settings/settings-companion-apps";
import { CompanionAppsSettingsSection } from "../../src/big-picture/src/pages/settings/companion-apps";

for (const surface of ["desktop", "big-picture"]) {
  test(`${surface}: companion edits use settings Save/Discard and validate before staging`, async () => {
    const dom = new JSDOM("<!doctype html><body><div id='root'></div></body>", {
      url: "https://launcher.example",
    });
    Object.assign(globalThis, {
      window: dom.window,
      document: dom.window.document,
      HTMLElement: dom.window.HTMLElement,
      IS_REACT_ACT_ENVIRONMENT: true,
    });
    let preferences: any = { companionAppsEnabled: false, companionApps: [] };
    (globalThis as any).__companionPreferences = preferences;
    const writes: any[] = [];
    let editor: any;
    Object.assign(window, {
      electron: {
        platform: "win32",
        getUserPreferences: async () => preferences,
        onUserPreferencesUpdated: () => () => {},
        updateUserPreferences: async (patch: any) => {
          writes.push(patch);
          preferences = { ...preferences, ...patch };
        },
        showOpenDialog: async () => ({ filePaths: ["C:/Tools/Utility.exe"] }),
      },
    });
    function Screen() {
      editor = useSettingsDraft();
      return surface === "desktop" ? (
        <SettingsCompanionApps />
      ) : (
        <CompanionAppsSettingsSection />
      );
    }
    const router = createMemoryRouter([
      {
        path: "/",
        element: (
          <SettingsDraftProvider confirmationOverride={async () => true}>
            <Screen />
          </SettingsDraftProvider>
        ),
      },
    ]);
    const root = createRoot(document.getElementById("root")!);
    const flush = () => new Promise((resolve) => setTimeout(resolve, 10));
    const click = async (label: string) => {
      await act(async () => {
        const button = [...document.querySelectorAll("button")].find(
          (button) => button.textContent === label
        );
        assert.ok(button, `Missing button: ${label}`);
        assert.equal(button.disabled, false, `${label} enabled`);
        button.click();
        await flush();
      });
    };
    await act(async () => {
      root.render(<RouterProvider router={router} />);
      await flush();
    });
    try {
      await click("Add app");
      await click("Done");
      assert.match(
        document.body.textContent!,
        /Enter a name and an absolute executable path/
      );
      assert.equal(editor.preferences.companionApps.length, 0);
      await click(surface === "desktop" ? "Browse" : "Browse executable");
      if (surface !== "desktop") await click("Choose executable");
      await click("Done");
      assert.equal(document.querySelector('[role="dialog"]'), null);
      assert.equal(editor.preferences.companionApps[0].name, "Utility.exe");
      assert.equal(writes.length, 0, "Adding an app only stages preferences");
      await click("Discard edits");
      assert.equal(editor.preferences.companionApps.length, 0);
      assert.equal(writes.length, 0);
      await click("Add app");
      await click(surface === "desktop" ? "Browse" : "Browse executable");
      if (surface !== "desktop") await click("Choose executable");
      await act(async () => {
        const dialog = document.querySelector('[role="dialog"]')!;
        const adminToggle =
          dialog.querySelector<HTMLInputElement>('input[type="checkbox"]') ??
          dialog.querySelector<HTMLButtonElement>('[role="checkbox"]');
        assert.ok(adminToggle, "Run as administrator toggle exists");
        adminToggle.click();
        await flush();
      });
      await click("Done");
      await act(async () => {
        document
          .querySelector<HTMLInputElement>('input[type="checkbox"]')!
          .click();
        await flush();
      });
      await click("Save changes");
      assert.equal(writes.length, 1);
      assert.equal(preferences.companionAppsEnabled, true);
      assert.equal(
        preferences.companionApps[0].executablePath,
        "C:/Tools/Utility.exe"
      );
      assert.equal(preferences.companionApps[0].runAsAdmin, true);
      await click("Remove");
      assert.equal(writes.length, 1, "Removal is also staged");
      await click("Discard edits");
      assert.equal(editor.preferences.companionApps.length, 1);
      await click("Edit");
      await click("Cancel");
      assert.equal(editor.hasUnsavedChanges, false);
    } finally {
      await act(async () => root.unmount());
      router.dispose();
      dom.window.close();
    }
  });
}
