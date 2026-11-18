import assert from "node:assert/strict";
import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { describe, it } from "node:test";
import { JSDOM } from "jsdom";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";
// @ts-ignore The Node ESM test runner requires the source extension.
import { resolveManualPlaytimeWarningPreferences } from "../../../../shared/manual-playtime-warning-preferences.ts";

const requireModule = createRequire(import.meta.url);
const rendererPath = path.resolve(process.cwd(), "src/renderer/src");

function loadComponent(
  relativeFile: string,
  extraStubs: Record<string, unknown> = {}
) {
  const filename = path.join(rendererPath, relativeFile);
  const source = fs.readFileSync(filename, "utf8");
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      jsx: ts.JsxEmit.ReactJSX,
      esModuleInterop: true,
    },
    fileName: filename,
  });
  const exports: Record<string, React.ElementType> = {};
  new Function("exports", "require", outputText)(exports, (name: string) => {
    if (name.endsWith(".scss")) return {};
    return extraStubs[name] ?? requireModule(name);
  });
  return exports;
}

function renderHeroPanelPlaytime(
  preferences: Record<string, boolean>,
  hasManuallyUpdatedPlaytime = true
) {
  const gameDetailsContext = React.createContext({
    game: {
      id: "test",
      objectId: "test",
      title: "Test game",
      playTimeInMilliseconds: 3_600_000,
      lastTimePlayed: "2026-01-01T00:00:00.000Z",
      hasManuallyUpdatedPlaytime,
    },
    presentation: null,
    isGameRunning: false,
  });

  const { HeroPanelPlaytime } = loadComponent(
    "pages/game-details/hero/hero-panel-playtime.tsx",
    {
      "react-i18next": { useTranslation: () => ({ t: (key: string) => key }) },
      "@renderer/helpers": { formatDownloadProgress: () => "" },
      "@renderer/hooks": {
        useAppSelector: (selector: (state: unknown) => unknown) =>
          selector({
            download: { extraction: null },
            userPreferences: { value: preferences },
          }),
        useDate: () => ({ formatDistance: () => "recently" }),
        useDownload: () => ({ progress: "", lastPacket: null }),
        useFormat: () => ({ numberFormatter: new Intl.NumberFormat("en") }),
      },
      "@renderer/components": {
        Link: ({ children }: { children: React.ReactNode }) =>
          React.createElement("a", null, children),
      },
      "@renderer/context": { gameDetailsContext },
      "@renderer/constants": { MAX_MINUTES_TO_SHOW_IN_PLAYTIME: 120 },
      "@shared": {
        getDisplayedPlayTimeInMilliseconds: ({
          playTimeInMilliseconds,
        }: {
          playTimeInMilliseconds: number;
        }) => playTimeInMilliseconds,
        resolveManualPlaytimeWarningPreferences,
      },
      "react-tooltip": {
        Tooltip: (props: { id?: string }) =>
          React.createElement("div", { "data-testid": "tooltip", id: props.id }),
      },
    }
  );

  return new JSDOM(renderToStaticMarkup(React.createElement(HeroPanelPlaytime)));
}

function renderChangeGamePlaytimeModal(
  preferences: Record<string, boolean>,
  hasManuallyUpdatedPlaytime = false
) {
  const { ChangeGamePlaytimeModal } = loadComponent(
    "pages/game-details/modals/change-game-playtime-modal.tsx",
    {
      "react-i18next": { useTranslation: () => ({ t: (key: string) => key }) },
      "@renderer/components": {
        Button: ({ children }: { children: React.ReactNode }) =>
          React.createElement("button", null, children),
        Modal: ({ children }: { children: React.ReactNode }) =>
          React.createElement("div", null, children),
        TextField: () => React.createElement("input"),
      },
      "@renderer/hooks": {
        useAppSelector: (selector: (state: unknown) => unknown) =>
          selector({ userPreferences: { value: preferences } }),
      },
      "@shared": { resolveManualPlaytimeWarningPreferences },
      "react-tooltip": { Tooltip: () => null },
      "./playtime-breakdown-table": { PlaytimeBreakdownTable: () => null },
    }
  );

  return new JSDOM(
    renderToStaticMarkup(
      React.createElement(ChangeGamePlaytimeModal, {
        visible: true,
        onClose: () => {},
        changePlaytime: async () => {},
        game: {
          id: "test",
          objectId: "test",
          title: "Test game",
          playTimeInMilliseconds: 0,
          hasManuallyUpdatedPlaytime,
        },
      })
    )
  );
}

function renderLibraryGameCardLarge(
  preferences: Record<string, boolean>,
  hasManuallyUpdatedPlaytime = true
) {
  const { LibraryGameCardLarge } = loadComponent(
    "pages/library/library-game-card-large.tsx",
    {
      "react-i18next": { useTranslation: () => ({ t: (key: string) => key }) },
      "./library-category": {
        getLibraryPresentationImportSources: () => ({
          steam: false,
          epic: false,
        }),
      },
      "@renderer/hooks": {
        useGameCard: () => ({
          formatPlayTime: () => "20 hours",
          handleCardClick: () => {},
          handleContextMenuClick: () => {},
        }),
        useAppSelector: (selector: (state: unknown) => unknown) =>
          selector({ userPreferences: { value: preferences } }),
        useCoverPoster: () => undefined,
        isAnimatedCoverCandidate: () => false,
        useAnimatedSourceWarmup: () => {},
        useCatalogueImage: () => ({
          variants: null,
          placeholderStyle: undefined,
          markLoaded: () => {},
          markFailed: () => false,
        }),
        useViewportCatalogueImageUrl: () => null,
      },
      "@renderer/helpers/catalogue-images": {
        getCatalogueImageDensitySrcSet: () => "",
        pickCatalogueImageUrl: () => "",
      },
      "@renderer/helpers": {
        CLASSICS_PS_PLATFORM_LABELS: {},
        isGameReadyToPlay: () => false,
        resolveClassicsBadge: () => ({}),
      },
      "@renderer/components": {
        AchievementProgress: () => null,
        SteamLibraryBadge: () => null,
      },
      "@renderer/components/game-visibility-badge/game-visibility-badge": {
        GameVisibilityBadge: () => null,
      },
      "@shared": {
        formatBytes: () => "0 B",
        getDisplayedPlayTimeInMilliseconds: () => 0,
        resolveManualPlaytimeWarningPreferences,
      },
      "@renderer/pages/settings/emulation/emulator-icons": {
        EMULATOR_ICONS: {},
        RETROARCH_EMULATOR_ICON: "",
      },
    }
  );

  return new JSDOM(
    renderToStaticMarkup(
      React.createElement(LibraryGameCardLarge, {
        game: {
          id: "test",
          objectId: "test",
          title: "Test game",
          shop: "steam",
          hasManuallyUpdatedPlaytime,
        },
        onContextMenu: () => {},
      })
    )
  );
}

describe("manual playtime warning UI granularity", () => {
  it("HeroPanelPlaytime handles all 4 icon/text preference combinations", () => {
    const bothOn = renderHeroPanelPlaytime({});
    assert.ok(
      bothOn.window.document.querySelector(".hero-panel-playtime__manual-warning")
    );
    assert.equal(
      bothOn.window.document
        .querySelector(".hero-panel-playtime__play-time")
        ?.getAttribute("data-tooltip-content"),
      "manual_playtime_tooltip"
    );
    assert.ok(bothOn.window.document.getElementById("manual-playtime-warning"));
    bothOn.window.close();

    const textOnly = renderHeroPanelPlaytime({
      showManualPlaytimeWarningIcon: false,
      showManualPlaytimeWarningText: true,
    });
    assert.equal(
      textOnly.window.document.querySelector(
        ".hero-panel-playtime__manual-warning"
      ),
      null
    );
    assert.equal(
      textOnly.window.document
        .querySelector(".hero-panel-playtime__play-time")
        ?.getAttribute("data-tooltip-content"),
      "manual_playtime_tooltip"
    );
    assert.ok(textOnly.window.document.getElementById("manual-playtime-warning"));
    textOnly.window.close();

    const iconOnly = renderHeroPanelPlaytime({
      showManualPlaytimeWarningIcon: true,
      showManualPlaytimeWarningText: false,
    });
    assert.ok(
      iconOnly.window.document.querySelector(
        ".hero-panel-playtime__manual-warning"
      )
    );
    assert.equal(
      iconOnly.window.document
        .querySelector(".hero-panel-playtime__play-time")
        ?.getAttribute("data-tooltip-content"),
      null
    );
    assert.equal(
      iconOnly.window.document
        .querySelector(".hero-panel-playtime__play-time")
        ?.getAttribute("data-tooltip-id"),
      null
    );
    assert.equal(
      iconOnly.window.document.getElementById("manual-playtime-warning"),
      null
    );
    iconOnly.window.close();

    const bothOff = renderHeroPanelPlaytime({
      showManualPlaytimeWarningIcon: false,
      showManualPlaytimeWarningText: false,
    });
    assert.equal(
      bothOff.window.document.querySelector(
        ".hero-panel-playtime__manual-warning"
      ),
      null
    );
    assert.equal(
      bothOff.window.document.getElementById("manual-playtime-warning"),
      null
    );
    bothOff.window.close();
  });

  it("ChangeGamePlaytimeModal handles all 4 icon/text preference combinations", () => {
    const bothOn = renderChangeGamePlaytimeModal({});
    const bannerBothOn = bothOn.window.document.querySelector(
      ".change-game-playtime-modal__warning"
    );
    assert.ok(bannerBothOn);
    assert.ok(bannerBothOn.querySelector("svg"));
    assert.match(bannerBothOn.textContent ?? "", /manual_playtime_warning/);
    bothOn.window.close();

    const textOnly = renderChangeGamePlaytimeModal({
      showManualPlaytimeWarningIcon: false,
      showManualPlaytimeWarningText: true,
    });
    const bannerTextOnly = textOnly.window.document.querySelector(
      ".change-game-playtime-modal__warning"
    );
    assert.ok(bannerTextOnly);
    assert.equal(bannerTextOnly.querySelector("svg"), null);
    assert.match(bannerTextOnly.textContent ?? "", /manual_playtime_warning/);
    textOnly.window.close();

    const iconOnly = renderChangeGamePlaytimeModal({
      showManualPlaytimeWarningIcon: true,
      showManualPlaytimeWarningText: false,
    });
    assert.equal(
      iconOnly.window.document.querySelector(
        ".change-game-playtime-modal__warning"
      ),
      null
    );
    iconOnly.window.close();

    const bothOff = renderChangeGamePlaytimeModal({
      showManualPlaytimeWarningIcon: false,
      showManualPlaytimeWarningText: false,
    });
    assert.equal(
      bothOff.window.document.querySelector(
        ".change-game-playtime-modal__warning"
      ),
      null
    );
    bothOff.window.close();
  });

  it("LibraryGameCardLarge toggles manual playtime warning icon based on showManualPlaytimeWarningIcon", () => {
    const withIcon = renderLibraryGameCardLarge({});
    assert.ok(
      withIcon.window.document.querySelector(
        ".library-game-card-large__manual-playtime"
      )
    );
    withIcon.window.close();

    const withoutIcon = renderLibraryGameCardLarge({
      showManualPlaytimeWarningIcon: false,
    });
    assert.equal(
      withoutIcon.window.document.querySelector(
        ".library-game-card-large__manual-playtime"
      ),
      null
    );
    assert.ok(
      withoutIcon.window.document.querySelector(
        ".library-game-card-large__playtime svg"
      )
    );
    withoutIcon.window.close();
  });
});
