import { after, before, describe, it } from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { isAbsolute, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";
import { JSDOM } from "jsdom";

const require = createRequire(import.meta.url);
const projectRoot = fileURLToPath(
  new URL("../../../../../../", import.meta.url)
);
const previousGlobals = new Map<string, PropertyDescriptor | undefined>();
let dom: JSDOM;
let directory: string;
let verifyModalFocus: (
  enabled: boolean,
  navigateBeforeActivation: boolean
) => Promise<void>;
let verifyBigPictureControls: (
  scenario: "controller" | "mouse" | "keyboard" | "loading" | "modal"
) => Promise<void>;
let verifyBackupSettingsScreens: (advanced: boolean) => Promise<void>;
let verifyResetSettingsScreens: (
  bigPicture: boolean,
  writes: () => number
) => Promise<void>;
let verifySettingsButtonNavigation: () => Promise<void>;

function setGlobal(key: string, value: unknown) {
  previousGlobals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
  Object.defineProperty(globalThis, key, { configurable: true, value });
}

before(async () => {
  dom = new JSDOM('<div id="root"></div><div id="big-picture"></div>', {
    pretendToBeVisual: true,
    url: "http://localhost/",
  });
  const window = dom.window;
  Object.defineProperty(window, "electron", {
    configurable: true,
    value: { platform: "win32" },
  });
  for (const key of [
    "window",
    "document",
    "self",
    "Window",
    "HTMLElement",
    "Element",
    "Node",
    "KeyboardEvent",
    "MouseEvent",
    "HTMLInputElement",
    "HTMLButtonElement",
    "HTMLTextAreaElement",
    "SVGElement",
    "CustomEvent",
    "FocusEvent",
    "localStorage",
  ] as const) {
    setGlobal(key, window[key]);
  }
  for (const key of [
    "getComputedStyle",
    "requestAnimationFrame",
    "cancelAnimationFrame",
    "addEventListener",
    "removeEventListener",
  ] as const) {
    setGlobal(key, window[key].bind(window));
  }
  setGlobal("navigator", window.navigator);
  setGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  // jsdom has no layout or scrolling. Model visible, rendered modal controls.
  window.scrollTo = () => {};
  window.HTMLElement.prototype.getClientRects = function () {
    return (this.hidden || this.style.display === "none"
      ? []
      : [{}]) as unknown as DOMRectList;
  };

  directory = await mkdtemp(join(tmpdir(), "hydra-modal-focus-"));
  const output = join(directory, "fixture.mjs");
  // Bundle TSX and ignore assets so Node runs the production React components.
  // External imports use project-resolved URLs, including when temp is on Windows.
  await build({
    entryPoints: [
      fileURLToPath(new URL("./modal-focus.fixture.tsx", import.meta.url)),
    ],
    bundle: true,
    platform: "node",
    format: "esm",
    packages: "external",
    outfile: output,
    tsconfig: join(projectRoot, "tsconfig.web.json"),
    plugins: [
      {
        name: "test-package-resolution",
        setup(builder) {
          builder.onResolve(
            { filter: /\.(svg|png|jpg|webp|wav)(\?react)?$/ },
            (args) => ({ path: args.path, namespace: "test-asset" })
          );
          builder.onLoad({ filter: /.*/, namespace: "test-asset" }, (args) => ({
            contents: args.path.endsWith("?react")
              ? "export default function TestIcon() { return null; }"
              : "export default 'test-asset';",
            loader: "js",
          }));
          builder.onResolve(
            { filter: /^(lodash-es|electron-log)\// },
            (args) => ({
              path: require.resolve(args.path),
            })
          );
          builder.onResolve({ filter: /^[^./]/ }, (args) => {
            if (isAbsolute(args.path)) return;
            if (/^@(shared|types|renderer|locales)(\/|$)/.test(args.path))
              return;
            return { path: import.meta.resolve(args.path), external: true };
          });
        },
      },
    ],
    loader: {
      ".scss": "empty",
      ".css": "empty",
      ".wav": "text",
      ".png": "text",
      ".svg": "text",
      ".jpg": "text",
      ".webp": "text",
    },
    define: { "process.env.NODE_ENV": '"test"' },
  });
  ({
    verifyModalFocus,
    verifyBigPictureControls,
    verifyBackupSettingsScreens,
    verifyResetSettingsScreens,
    verifySettingsButtonNavigation,
  } = await import(pathToFileURL(output).href));
});

describe("guarded settings resets", () => {
  for (const bigPicture of [false, true]) {
    it(`reviews, cancels and saves only explicit resets in ${bigPicture ? "Big Picture" : "desktop"}`, async () => {
      let writes = 0,
        runAtStartup = true;
      const subscription = () => () => {};
      Object.defineProperty(dom.window, "electron", {
        configurable: true,
        value: {
          getUserPreferences: async () => ({ runAtStartup }),
          onUserPreferencesUpdated: subscription,
          onLudusaviStateChanged: subscription,
          onCustomThemeUpdated: subscription,
          onGamesRunning: subscription,
          getLibrary: async () => [],
          getSettingsResetStatus: async (target: { group: string }) => ({
            target,
            isDefault:
              !["general", "combined"].includes(target.group) || !runAtStartup,
            recovery: null,
          }),
          previewSettingsReset: async (target: { group: string }) => ({
            token: "review",
            target,
            restoring: false,
            expiresAt: Date.now() + 300_000,
            changes: [
              {
                key: "runAtStartup",
                label: "Run at startup",
                before: "On",
                after: "Off",
              },
            ],
            warnings: ["Settings only"],
            confirmationPhrase:
              target.group === "combined" ? "RESET SETTINGS" : null,
            directTorrentConfirmation: false,
          }),
          applySettingsReset: async () => {
            writes++;
            runAtStartup = false;
          },
        },
      });
      await verifyResetSettingsScreens(bigPicture, () => writes);
    });
  }
});

after(async () => {
  dom?.window.close();
  for (const [key, descriptor] of previousGlobals) {
    if (descriptor) Object.defineProperty(globalThis, key, descriptor);
    else Reflect.deleteProperty(globalThis, key);
  }
  if (directory) await rm(directory, { recursive: true, force: true });
});

describe("modal physical keyboard focus", () => {
  for (const setting of [undefined, true, false]) {
    for (const navigateBeforeActivation of [false, true]) {
      const activation = navigateBeforeActivation
        ? "after controller navigation"
        : "directly after Tab";
      it(`supports typing, Tab, Shift+Tab and activation ${activation} with virtual keyboard ${setting ?? "enabled by default"}`, async () => {
        Object.defineProperty(dom.window, "electron", {
          configurable: true,
          value: {
            getUserPreferences: async () =>
              setting === undefined
                ? null
                : { bigPictureVirtualKeyboardEnabled: setting },
          },
        });
        await verifyModalFocus(setting ?? true, navigateBeforeActivation);
      });
    }
  }
});

describe("Big Picture input and modal safeguards", () => {
  for (const scenario of [
    "controller",
    "mouse",
    "keyboard",
    "loading",
    "modal",
  ] as const) {
    it(scenario, async () => {
      Object.defineProperty(dom.window, "electron", {
        configurable: true,
        value: { getUserPreferences: async () => null },
      });
      await verifyBigPictureControls(scenario);
    });
  }
});

describe("Big Picture backup and advanced settings", () => {
  for (const advanced of [false, true]) {
    it(
      advanced
        ? "guards tools and preserves newly added website drafts"
        : "keeps sensitive backup controls out of everyday settings",
      async () => {
        const noopSubscription = () => () => {};
        Object.defineProperty(dom.window, "electron", {
          configurable: true,
          value: {
            getUserPreferences: async () => null,
            getLibrary: async () => [],
            onLibraryBatchComplete: noopSubscription,
            onDownloadsUpdated: noopSubscription,
            getNetworkInterfaces: async () => [],
            getDownloadSources: async () => [],
            getSourceWebsiteProfiles: async () => ({}),
            clearSourceWebsiteData: async () => {
              throw new Error("Fixture cookie clearing failed");
            },
            getExcludedLibraryGames: async () => [],
            onExcludedLibraryGamesUpdated: noopSubscription,
            getGamesRunning: async () => [],
            onGamesRunning: noopSubscription,
            hydraApi: { get: async () => [] },
            onLudusaviStateChanged: noopSubscription,
            getLudusaviLocalState: async () => ({
              settings: {
                enabled: true,
                destination: "C:/fixture/backups",
                fullRetention: 10,
                games: {},
              },
              games: [],
              history: [],
              busy: false,
              bulkProgress: { running: false },
            }),
          },
        });
        await verifyBackupSettingsScreens(advanced);
      }
    );
  }
});

describe("Big Picture settings directional button navigation", () => {
  it("supports 2D Left/Right/Up/Down navigation in Advanced tools, Companion Apps, Save Backups, and Reset", async () => {
    const noopSubscription = () => () => {};
    Object.defineProperty(dom.window, "electron", {
      configurable: true,
      value: {
        platform: "win32",
        getUserPreferences: async () => ({
          companionAppsEnabled: true,
          companionApps: [
            {
              id: "app-1",
              name: "DS4Windows",
              executablePath: "C:/Tools/DS4Windows.exe",
              enabled: true,
            },
          ],
        }),
        onUserPreferencesUpdated: noopSubscription,
        onLudusaviStateChanged: noopSubscription,
        onCustomThemeUpdated: noopSubscription,
        onGamesRunning: noopSubscription,
        onExcludedLibraryGamesUpdated: noopSubscription,
        onLibraryBatchComplete: noopSubscription,
        onDownloadsUpdated: noopSubscription,
        getLibrary: async () => [],
        getNetworkInterfaces: async () => [],
        getDownloadSources: async () => [],
        getSourceWebsiteProfiles: async () => ({}),
        getExcludedLibraryGames: async () => [],
        getGamesRunning: async () => [],
        hydraApi: { get: async () => [] },
        getLudusaviLocalState: async () => ({
          settings: {
            enabled: true,
            destination: "C:/fixture/backups",
            fullRetention: 10,
            games: {},
          },
          games: [{ key: "steam:1", title: "Portal" }],
          gameSummaries: {},
          history: [],
          busy: false,
          bulkProgress: { running: false },
        }),
        getSettingsResetStatus: async (target: { group: string }) => ({
          target,
          isDefault: target.group !== "general",
          recovery:
            target.group === "general"
              ? { savedAt: Date.now(), interrupted: false }
              : null,
        }),
      },
    });
    await verifySettingsButtonNavigation();
  });
});
