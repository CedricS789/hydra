import assert from "node:assert/strict";
import { act, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  MemoryRouter,
  createMemoryRouter,
  RouterProvider,
} from "react-router-dom";
import {
  SettingsDraftProvider,
  useSettingsDraft,
} from "@renderer/context/settings/settings-draft.context";
import { SettingsReset } from "@renderer/pages/settings/settings-reset";
import { ResetSettingsSection } from "../../../pages/settings/reset";
import { Modal } from "./index";
import { Input } from "../input";
import { FocusItem } from "../focus-item";
import { VerticalFocusGroup } from "../vertical-focus-group";
import { VirtualKeyboardProvider } from "../virtual-keyboard";
import { NavigationStateBridge } from "../../providers/navigation-state-bridge.provider";
import { NavigationService } from "../../../services/navigation.service";
import { NavigationItemActionsService } from "../../../services/navigation-item-actions.service";
import { useVirtualKeyboardStore } from "../../../stores/virtual-keyboard.store";
import { Button } from "../button";
import { InputModeProvider } from "../../providers/input-mode.provider";
import { NavigationInputProvider } from "../../providers/navigation-input.provider";
import { useInputModeStore } from "../../../stores/input-mode.store";
import { useGamepadStore } from "../../../stores/gamepad.store";
import { GamepadButtonType } from "../../../types";
import { GamepadService } from "../../../services/gamepad.service";
import { AdvancedSettingsSection } from "../../../pages/settings/advanced";
import { CompanionAppsSettingsSection } from "../../../pages/settings/companion-apps";
import { SaveBackupsSettingsSection } from "../../../pages/settings/save-backups";
import i18next from "i18next";
import { initReactI18next } from "react-i18next";

function Fixture() {
  const [value, setValue] = useState("");

  return (
    <MemoryRouter
      future={{ v7_startTransition: true, v7_relativeSplatPath: true }}
    >
      <NavigationStateBridge />
      <Modal visible onClose={() => {}} title="Language selector">
        <VerticalFocusGroup regionId="fixture-group">
          <Input
            id="search-input"
            focusId="search-owner"
            value={value}
            onChange={(event) => setValue(event.target.value)}
            placeholder="Search language"
          />
          <FocusItem id="action" asChild>
            <button type="button">Language option</button>
          </FocusItem>
          <output id="typed-value">{value}</output>
        </VerticalFocusGroup>
      </Modal>
      <VirtualKeyboardProvider />
    </MemoryRouter>
  );
}

export async function verifyBigPictureControls(
  scenario: "controller" | "mouse" | "keyboard" | "loading" | "modal"
) {
  let activations = 0;
  let otherActivations = 0;
  let closes = 0;
  let outerCloses = 0;
  const navigation = NavigationService.getInstance();
  Object.defineProperty(document, "hasFocus", {
    configurable: true,
    value: () => true,
  });
  const root = createRoot(document.getElementById("root")!);
  const buttons = (pressed: boolean) => {
    useGamepadStore.setState({
      states: new Map([
        [
          0,
          {
            name: "Test controller",
            layout: "xbox",
            axes: new Map(),
            buttons: new Map([
              [
                GamepadButtonType.BUTTON_A,
                { pressed, value: pressed ? 1 : 0, lastUpdated: Date.now() },
              ],
            ]),
          },
        ],
      ]),
      activeGamepadIndex: 0,
      hasGamepadConnected: true,
    });
  };
  function Controls() {
    return (
      <MemoryRouter
        future={{ v7_startTransition: true, v7_relativeSplatPath: true }}
      >
        <NavigationStateBridge />
        <InputModeProvider />
        <NavigationInputProvider>
          <VerticalFocusGroup regionId="control-fixture">
            <Button
              focusId="launch-control"
              onClick={() => activations++}
              loading={scenario === "loading"}
            >
              Launch
            </Button>
            <Button focusId="other-control" onClick={() => otherActivations++}>
              Other
            </Button>
          </VerticalFocusGroup>
          {scenario === "modal" && (
            <>
              <Modal visible title="Outer" onClose={() => outerCloses++}>
                <p>Outer</p>
              </Modal>
              <Modal visible title="Busy inner" busy onClose={() => closes++}>
                <p>Busy</p>
              </Modal>
            </>
          )}
        </NavigationInputProvider>
      </MemoryRouter>
    );
  }
  try {
    useVirtualKeyboardStore.setState({ target: null });
    await act(async () => root.render(<Controls />));
    const launch = document.getElementById(
      "launch-control"
    ) as HTMLButtonElement;
    const other = document.getElementById("other-control") as HTMLButtonElement;
    if (scenario === "loading") {
      assert.equal(launch.disabled, true);
      assert.equal(launch.dataset.navigationState, "disabled");
      await act(async () => launch.click());
      assert.equal(activations, 0);
    } else if (scenario === "controller") {
      await act(async () => {
        useInputModeStore.getState().setMouseMode();
      });
      useInputModeStore.getState().setMouseFocusSnapshot("launch-control");
      await act(async () => {
        useInputModeStore.getState().setGamepadMode();
        buttons(true);
      });
      await act(async () => buttons(false));
      assert.equal(
        activations,
        1,
        "the first controller press must launch after restoring a valid focus"
      );
      await act(async () => buttons(true));
      await act(async () => navigation.setFocus("other-control"));
      await act(async () => buttons(false));
      assert.equal(
        otherActivations,
        0,
        "releasing a button after focus changes must not activate a different control"
      );
    } else if (scenario === "mouse") {
      await act(async () => useInputModeStore.getState().setMouseMode());
      await act(async () => useInputModeStore.getState().setGamepadMode());
      GamepadService.getInstance().markGamepadActivity();
      assert.notEqual(window.getComputedStyle(launch).pointerEvents, "none");
      await act(async () => {
        launch.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
        launch.click();
      });
      assert.equal(useInputModeStore.getState().mode, "mouse");
      assert.equal(activations, 1);
    } else if (scenario === "keyboard") {
      await act(async () => useInputModeStore.getState().setMouseMode());
      await act(async () => navigation.setFocus("launch-control"));
      other.focus();
      const event = new KeyboardEvent("keydown", {
        key: "Enter",
        bubbles: true,
        cancelable: true,
      });
      await act(async () => other.dispatchEvent(event));
      assert.equal(
        event.defaultPrevented,
        false,
        "native Enter must activate the DOM-focused control"
      );
      assert.equal(activations, 0);
      await act(async () => other.click());
      assert.equal(otherActivations, 1);
    } else {
      const close = document.querySelectorAll<HTMLButtonElement>(
        ".modal__header-close-button"
      );
      assert.equal(close[close.length - 1].disabled, true);
      await act(async () => close[close.length - 1].click());
      await act(async () =>
        window.dispatchEvent(
          new KeyboardEvent("keydown", {
            key: "Escape",
            bubbles: true,
            cancelable: true,
          })
        )
      );
      await act(async () =>
        document.body.dispatchEvent(
          new MouseEvent("pointerdown", { bubbles: true })
        )
      );
      assert.equal(closes, 0);
      assert.equal(outerCloses, 0);
    }
  } finally {
    await act(async () => root.unmount());
    useGamepadStore.setState({
      states: new Map(),
      activeGamepadIndex: null,
      hasGamepadConnected: false,
    });
    useInputModeStore.getState().setMouseMode();
  }
}

export async function verifyBackupSettingsScreens(advanced: boolean) {
  await i18next.use(initReactI18next).init({
    lng: "en",
    resources: { en: { translation: {} } },
    initImmediate: false,
  });
  const root = createRoot(document.getElementById("root")!);
  try {
    await act(async () =>
      root.render(
        <MemoryRouter
          future={{ v7_startTransition: true, v7_relativeSplatPath: true }}
        >
          <NavigationStateBridge />
          {advanced ? (
            <AdvancedSettingsSection />
          ) : (
            <SaveBackupsSettingsSection />
          )}
        </MemoryRouter>
      )
    );
    const findButton = (text: string) =>
      [...document.querySelectorAll<HTMLButtonElement>("button")].find(
        (button) => button.textContent?.trim() === text
      );
    if (!advanced) {
      assert.equal(findButton("Restore & Versions"), undefined);
      assert.equal(findButton("Rules & Destination"), undefined);
      assert.equal(document.getElementById("bp-save-global-enabled"), null);
      return;
    }
    assert.equal(
      findButton("Source websites & cookies"),
      undefined,
      "advanced tools must start locked"
    );
    const acknowledgement = document.getElementById(
      "bp-advanced-gate-ack"
    ) as HTMLButtonElement;
    await act(async () => acknowledgement.click());
    await act(async () => findButton("advanced_gate_open")!.click());
    assert.ok(findButton("Save backup configuration & recovery"));
    assert.ok(findButton("Reset and recovery"));
    assert.equal(
      document.querySelector<HTMLInputElement>(
        'input[value="https://steamrip.com/"]'
      ),
      null
    );
    await act(async () => findButton("Source websites & cookies")!.click());
    const nameInput =
      [...document.querySelectorAll<HTMLInputElement>("input")].find((input) =>
        input
          .closest(".input")
          ?.textContent?.includes("New website profile name")
      ) ?? document.querySelector<HTMLInputElement>("input");
    assert.ok(nameInput);
    await act(async () => {
      Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value"
      )!.set!.call(nameInput, "New independent website");
      nameInput.dispatchEvent(new window.Event("input", { bubbles: true }));
    });
    await act(async () => findButton("Add profile")!.click());
    assert.ok(
      document.body.textContent?.includes("Search address (includes {query})"),
      "adding a profile must not reload profiles and discard the new draft"
    );
    await act(async () => findButton("Clear website data")!.click());
    const confirmation = [
      ...document.querySelectorAll<HTMLButtonElement>("button"),
    ]
      .filter((button) => button.textContent?.trim() === "Clear website data")
      .at(-1)!;
    await act(async () => confirmation.click());
    assert.ok(
      document.body.textContent?.includes("Fixture cookie clearing failed"),
      "website data errors must be reported without an unhandled rejection"
    );
  } finally {
    await act(async () => root.unmount());
  }
}

export async function verifyResetSettingsScreens(
  bigPicture: boolean,
  writes: () => number
) {
  await i18next.use(initReactI18next).init({
    lng: "en",
    resources: { en: { translation: {} } },
    initImmediate: false,
  });
  let draft: ReturnType<typeof useSettingsDraft>;
  function Screen() {
    draft = useSettingsDraft();
    return (
      <>
        <NavigationStateBridge />
        {bigPicture ? <ResetSettingsSection /> : <SettingsReset />}
      </>
    );
  }
  const router = createMemoryRouter([
    {
      path: "/",
      element: (
        <SettingsDraftProvider>
          <Screen />
        </SettingsDraftProvider>
      ),
    },
  ]);
  const root = createRoot(document.getElementById("root")!);
  const button = (label: string) =>
    [...document.querySelectorAll<HTMLButtonElement>("button")].find(
      (element) => element.textContent?.trim() === label
    )!;
  const resetGeneral = () =>
    [...document.querySelectorAll<HTMLElement>(".settings-reset__card")]
      .find(
        (element) =>
          element.querySelector("h4")?.textContent === "General behavior"
      )!
      .querySelector<HTMLButtonElement>("button")!;
  const flush = () => new Promise((resolve) => setTimeout(resolve, 35));
  try {
    await act(async () => {
      root.render(<RouterProvider router={router} />);
      await flush();
    });
    assert.equal(resetGeneral().disabled, false);
    await act(async () => {
      await draft!.stage({ runAtStartup: false });
    });
    assert.equal(
      resetGeneral().disabled,
      true,
      "unsaved edits must block reset reviews"
    );
    await act(async () => {
      await draft!.stage({ runAtStartup: true });
    });
    assert.equal(
      resetGeneral().disabled,
      false,
      "undoing the edit must clear the dirty state"
    );
    await act(async () => {
      resetGeneral().click();
      await flush();
    });
    assert.ok(document.querySelector('[role="dialog"]'));
    assert.ok(document.body.textContent?.includes("Proposed"));
    assert.equal(writes(), 0, "reviewing must never apply a reset");
    if (bigPicture) {
      assert.equal(
        NavigationService.getInstance().getCurrentFocusId(),
        "settings-reset-cancel"
      );
      await act(async () => {
        NavigationItemActionsService.getInstance().triggerPrimaryForFocusedItem();
        await flush();
      });
    } else
      await act(async () => {
        button("Cancel").click();
        await flush();
      });
    assert.equal(writes(), 0);
    const combined = [
      ...document.querySelectorAll<HTMLElement>(".settings-reset__card"),
    ]
      .find(
        (element) =>
          element.querySelector("h4")?.textContent === "Reset app preferences"
      )!
      .querySelector<HTMLButtonElement>("button")!;
    await act(async () => {
      combined.click();
      await flush();
    });
    assert.equal(
      button("Apply reset").disabled,
      true,
      "combined reset must require acknowledgement and typed confirmation"
    );
    await act(async () => {
      document
        .querySelector<HTMLElement>(
          '.settings-reset__review [role="checkbox"], .settings-reset__review input[type="checkbox"]'
        )!
        .click();
    });
    assert.equal(
      button("Apply reset").disabled,
      true,
      "acknowledgement alone is insufficient"
    );
    const confirmation = document.querySelector<HTMLInputElement>(
      '.settings-reset__review input[type="text"]'
    )!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value"
      )!.set!.call(confirmation, "RESET SETTINGS");
      confirmation.dispatchEvent(new window.Event("input", { bubbles: true }));
    });
    assert.equal(button("Apply reset").disabled, false);
    await act(async () => {
      button("Cancel").click();
      await flush();
    });
    assert.equal(writes(), 0);
    await act(async () => {
      resetGeneral().click();
      await flush();
    });
    assert.equal(button("Apply reset").disabled, false);
    await act(async () => {
      button("Apply reset").click();
      await flush();
    });
    assert.equal(writes(), 1);
    assert.ok(document.body.textContent?.includes("Reset saved"));
  } finally {
    await act(async () => root.unmount());
    router.dispose();
  }
}

async function tab(backwards = false) {
  await act(async () => {
    window.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "Tab",
        shiftKey: backwards,
        bubbles: true,
        cancelable: true,
      })
    );
  });
  assert.equal(useVirtualKeyboardStore.getState().target, null);
}

export async function verifyModalFocus(
  virtualKeyboardEnabled: boolean,
  navigateBeforeActivation: boolean
) {
  const root = createRoot(document.getElementById("root")!);

  try {
    await act(async () => root.render(<Fixture />));
    const close = document.querySelector<HTMLButtonElement>(
      ".modal__header-close-button"
    )!;
    const input = document.getElementById("search-input") as HTMLInputElement;
    const action = document.getElementById("action")!;

    close.focus();
    await tab();
    assert.equal(document.activeElement, input);
    assert.equal(
      NavigationService.getInstance().getCurrentFocusId(),
      "search-owner"
    );

    await act(async () => {
      Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value"
      )!.set!.call(input, "French");
      input.dispatchEvent(new window.Event("input", { bubbles: true }));
    });
    assert.equal(document.getElementById("typed-value")!.textContent, "French");
    assert.equal(document.activeElement, input);

    await tab();
    assert.equal(document.activeElement, action);
    await tab(true);
    assert.equal(document.activeElement, input);
    // This is the reported failure: the next Tab must still reach the action.
    await tab();
    assert.equal(document.activeElement, action);
    await tab();
    assert.equal(document.activeElement, close);
    await tab(true);
    assert.equal(document.activeElement, action);
    await tab(true);
    assert.equal(document.activeElement, input);
    await tab(true);
    assert.equal(document.activeElement, close);

    await tab();
    if (navigateBeforeActivation) {
      await act(async () => NavigationService.getInstance().moveFocus("down"));
      assert.equal(document.activeElement, action);
      await act(async () => NavigationService.getInstance().moveFocus("up"));
      assert.equal(document.activeElement?.id, "search-owner");
    } else {
      assert.equal(document.activeElement, input);
    }
    await act(async () =>
      NavigationItemActionsService.getInstance().triggerPrimaryForFocusedItem()
    );
    if (virtualKeyboardEnabled) {
      assert.ok(
        useVirtualKeyboardStore.getState().target === input,
        "Controller activation must open the virtual keyboard for this input"
      );
      assert.ok(
        document.querySelector(
          '[data-focus-region-id="big-picture-virtual-keyboard"]'
        )
      );
    } else {
      assert.equal(useVirtualKeyboardStore.getState().target, null);
      assert.equal(document.activeElement, input);
    }
  } finally {
    await act(async () => root.unmount());
  }
}

export async function verifySettingsButtonNavigation() {
  await i18next.use(initReactI18next).init({
    lng: "en",
    resources: { en: { translation: {} } },
    initImmediate: false,
  });

  const navigation = NavigationService.getInstance();
  const root = createRoot(document.getElementById("root")!);
  const originalGetBoundingClientRect =
    window.HTMLElement.prototype.getBoundingClientRect;
  const rectsByElement = new WeakMap<HTMLElement, DOMRect>();
  const makeRect = (left: number, top: number, width: number, height: number) =>
    ({
      left,
      top,
      right: left + width,
      bottom: top + height,
      width,
      height,
      x: left,
      y: top,
      toJSON() {
        return {};
      },
    }) as DOMRect;

  window.HTMLElement.prototype.getBoundingClientRect = function () {
    return rectsByElement.get(this) ?? makeRect(0, 0, 0, 0);
  };

  const findButton = (text: string) =>
    [...document.querySelectorAll<HTMLButtonElement>("button")].find(
      (button) => button.textContent?.trim() === text
    );
  const focusedText = () => document.activeElement?.textContent?.trim();
  const flush = () => new Promise((resolve) => setTimeout(resolve, 35));

  try {
    // 1. Advanced tools wrapped 2-row layout inside an outer region with left sidebar override
    await act(async () =>
      root.render(
        <MemoryRouter
          future={{ v7_startTransition: true, v7_relativeSplatPath: true }}
        >
          <NavigationStateBridge />
          <VerticalFocusGroup regionId="shell-sidebar">
            <FocusItem id="sidebar-settings-item" asChild>
              <button type="button">Sidebar Settings</button>
            </FocusItem>
          </VerticalFocusGroup>
          <VerticalFocusGroup
            regionId="content-shell"
            navigationOverrides={{
              left: { type: "item", itemId: "sidebar-settings-item" },
            }}
          >
            <AdvancedSettingsSection />
          </VerticalFocusGroup>
        </MemoryRouter>
      )
    );

    const ack = document.getElementById(
      "bp-advanced-gate-ack"
    ) as HTMLButtonElement;
    await act(async () => ack.click());
    await act(async () => findButton("advanced_gate_open")!.click());

    const lockButton = findButton("advanced_lock")!;
    rectsByElement.set(lockButton, makeRect(800, 40, 180, 40));

    const toolButtons = [
      ...document.querySelectorAll<HTMLButtonElement>(
        ".bp-advanced__actions button"
      ),
    ];
    assert.equal(toolButtons.length, 10);
    // Row 1: first 6 buttons; Row 2: remaining 4 buttons
    const row1Widths = [220, 90, 140, 150, 240, 200];
    let x = 100;
    for (let i = 0; i < 6; i++) {
      rectsByElement.set(toolButtons[i], makeRect(x, 120, row1Widths[i], 40));
      x += row1Widths[i] + 12;
    }
    const row2Widths = [220, 240, 260, 160];
    x = 100;
    for (let i = 0; i < 4; i++) {
      rectsByElement.set(
        toolButtons[6 + i],
        makeRect(x, 172, row2Widths[i], 40)
      );
      x += row2Widths[i] + 12;
    }

    await act(async () => {
      navigation.setFocus(toolButtons[0].id);
    });
    assert.equal(focusedText(), "Download protection & network");

    await act(async () => {
      navigation.moveFocus("right");
    });
    assert.equal(focusedText(), "Features");

    await act(async () => {
      navigation.moveFocus("right");
    });
    assert.equal(focusedText(), "advanced_media_title");

    await act(async () => {
      navigation.moveFocus("left");
    });
    assert.equal(focusedText(), "Features");

    await act(async () => {
      navigation.moveFocus("down");
    });
    assert.equal(focusedText(), "Library management & exclusions");

    await act(async () => {
      navigation.moveFocus("left");
    });
    assert.equal(focusedText(), "Social & community visibility");

    await act(async () => {
      navigation.moveFocus("right");
    });
    assert.equal(focusedText(), "Library management & exclusions");

    await act(async () => {
      navigation.moveFocus("left");
    });
    assert.equal(focusedText(), "Social & community visibility");

    await act(async () => {
      navigation.moveFocus("up");
    });
    assert.equal(focusedText(), "Download protection & network");

    await act(async () => {
      navigation.moveFocus("up");
    });
    assert.equal(focusedText(), "advanced_lock");

    await act(async () => {
      navigation.moveFocus("down");
    });
    assert.equal(focusedText(), "Download protection & network");

    await act(async () => {
      navigation.moveFocus("left");
    });
    assert.equal(focusedText(), "Sidebar Settings");

    // 2. Companion apps row: Checkbox <-> Edit <-> Remove
    await act(async () =>
      root.render(
        <MemoryRouter
          future={{ v7_startTransition: true, v7_relativeSplatPath: true }}
        >
          <NavigationStateBridge />
          <VerticalFocusGroup regionId="companion-outer">
            <CompanionAppsSettingsSection />
          </VerticalFocusGroup>
        </MemoryRouter>
      )
    );
    const appCheckboxes = [
      ...document.querySelectorAll<HTMLButtonElement>(
        '.companion-apps__row [role="checkbox"]'
      ),
    ];
    const editButtons = [
      ...document.querySelectorAll<HTMLButtonElement>(
        ".companion-apps__actions button"
      ),
    ];
    assert.equal(appCheckboxes.length, 1);
    assert.equal(editButtons.length, 2);
    rectsByElement.set(appCheckboxes[0], makeRect(100, 100, 24, 24));
    rectsByElement.set(editButtons[0], makeRect(600, 96, 80, 36));
    rectsByElement.set(editButtons[1], makeRect(690, 96, 90, 36));

    await act(async () => {
      navigation.moveFocus("down");
    });
    assert.equal(document.activeElement, appCheckboxes[0]);
    await act(async () => {
      navigation.moveFocus("right");
    });
    assert.equal(focusedText(), "companion_apps_edit");
    await act(async () => {
      navigation.moveFocus("right");
    });
    assert.equal(focusedText(), "companion_apps_remove");
    await act(async () => {
      navigation.moveFocus("left");
    });
    assert.equal(focusedText(), "companion_apps_edit");
    await act(async () => {
      navigation.moveFocus("left");
    });
    assert.equal(document.activeElement, appCheckboxes[0]);

    // 3. Save backups overview: top switcher + game card Backup <-> Manage
    await act(async () =>
      root.render(
        <MemoryRouter
          future={{ v7_startTransition: true, v7_relativeSplatPath: true }}
        >
          <NavigationStateBridge />
          <SaveBackupsSettingsSection advanced />
        </MemoryRouter>
      )
    );
    await act(async () => {
      await flush();
    });
    const topButtons = [
      ...document.querySelectorAll<HTMLButtonElement>(
        '[data-focus-region-id="bp-save-backups-top-actions"] button'
      ),
    ];
    assert.equal(topButtons.length, 5);
    topButtons.forEach((btn, idx) =>
      rectsByElement.set(btn, makeRect(100 + idx * 160, 40, 140, 40))
    );
    const cardButtons = [
      ...document.querySelectorAll<HTMLButtonElement>(
        ".bp-save-backups__item-card .bp-save-backups__actions button"
      ),
    ];
    assert.equal(cardButtons.length, 2);
    rectsByElement.set(cardButtons[0], makeRect(600, 220, 80, 32));
    rectsByElement.set(cardButtons[1], makeRect(692, 220, 80, 32));

    await act(async () => {
      navigation.setFocus(topButtons[0].id);
      navigation.moveFocus("right");
    });
    assert.equal(document.activeElement, topButtons[1]);
    await act(async () => {
      navigation.setFocus(cardButtons[0].id);
      navigation.moveFocus("right");
    });
    assert.equal(document.activeElement, cardButtons[1]);
    await act(async () => {
      navigation.moveFocus("left");
    });
    assert.equal(document.activeElement, cardButtons[0]);

    // 4. Reset and recovery: Review reset <-> Restore previous settings
    const router = createMemoryRouter([
      {
        path: "/",
        element: (
          <SettingsDraftProvider>
            <NavigationStateBridge />
            <ResetSettingsSection />
          </SettingsDraftProvider>
        ),
      },
    ]);
    await act(async () => {
      root.render(<RouterProvider router={router} />);
      await flush();
    });
    const resetCardActions = [
      ...document.querySelectorAll<HTMLButtonElement>(
        ".settings-reset__card .settings-reset__actions button"
      ),
    ];
    const restoreBtn = resetCardActions.find(
      (btn) => btn.textContent?.trim() === "Restore previous settings"
    );
    assert.ok(restoreBtn);
    const reviewBtn = restoreBtn.parentElement!.querySelectorAll("button")[0];
    rectsByElement.set(reviewBtn, makeRect(100, 300, 140, 40));
    rectsByElement.set(restoreBtn, makeRect(252, 300, 200, 40));

    await act(async () => {
      navigation.setFocus(reviewBtn.id);
      navigation.moveFocus("right");
    });
    assert.equal(document.activeElement, restoreBtn);
    await act(async () => {
      navigation.moveFocus("left");
    });
    assert.equal(document.activeElement, reviewBtn);
    router.dispose();
  } finally {
    window.HTMLElement.prototype.getBoundingClientRect =
      originalGetBoundingClientRect;
    await act(async () => root.unmount());
  }
}
