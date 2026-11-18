import assert from "node:assert/strict";
import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { afterEach, describe, it } from "node:test";
import ts from "typescript";
import type * as WindowSliceModule from "../../features/window-slice";
import type * as SidebarVisibilityModule from "./sidebar-visibility";
import type { SidebarShortcutEventLike } from "./sidebar-visibility";

const requireModule = createRequire(import.meta.url);

const visibilityFilename = path.resolve(
  "src/renderer/src/components/sidebar/sidebar-visibility.ts"
);
const visibilityCompiled = ts.transpileModule(
  fs.readFileSync(visibilityFilename, "utf8"),
  {
    compilerOptions: { module: ts.ModuleKind.CommonJS },
    fileName: visibilityFilename,
  }
);
const visibilityLoaded = { exports: {} as typeof SidebarVisibilityModule };
new Function("require", "module", "exports", visibilityCompiled.outputText)(
  requireModule,
  visibilityLoaded,
  visibilityLoaded.exports
);
const {
  SIDEBAR_HIDDEN_STORAGE_KEY,
  isSidebarToggleShortcut,
  readStoredSidebarHidden,
  writeStoredSidebarHidden,
} = visibilityLoaded.exports;

const loadWindowSliceWithStorage = (storage: Storage) => {
  const previousLocalStorage = globalThis.localStorage;
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: storage,
  });

  const visibilityModule = { exports: {} as typeof SidebarVisibilityModule };
  new Function("require", "module", "exports", visibilityCompiled.outputText)(
    requireModule,
    visibilityModule,
    visibilityModule.exports
  );

  const sliceFilename = path.resolve(
    "src/renderer/src/features/window-slice.ts"
  );
  const sliceCompiled = ts.transpileModule(
    fs.readFileSync(sliceFilename, "utf8"),
    {
      compilerOptions: { module: ts.ModuleKind.CommonJS },
      fileName: sliceFilename,
    }
  );
  const sliceModule = { exports: {} as typeof WindowSliceModule };
  new Function("require", "module", "exports", sliceCompiled.outputText)(
    (specifier: string) =>
      specifier.endsWith("sidebar-visibility")
        ? visibilityModule.exports
        : requireModule(specifier),
    sliceModule,
    sliceModule.exports
  );

  return {
    ...sliceModule.exports,
    restore: () => {
      Object.defineProperty(globalThis, "localStorage", {
        configurable: true,
        value: previousLocalStorage,
      });
    },
  };
};

const createMemoryStorage = (initial: Record<string, string> = {}): Storage => {
  const map = new Map<string, string>(Object.entries(initial));
  return {
    get length() {
      return map.size;
    },
    clear: () => map.clear(),
    getItem: (key) => map.get(key) ?? null,
    key: (index) => Array.from(map.keys())[index] ?? null,
    removeItem: (key) => {
      map.delete(key);
    },
    setItem: (key, value) => {
      map.set(key, String(value));
    },
  };
};

const createShortcutEvent = (
  overrides: Partial<SidebarShortcutEventLike> = {}
): SidebarShortcutEventLike => ({
  key: "b",
  ctrlKey: true,
  metaKey: false,
  altKey: false,
  shiftKey: false,
  repeat: false,
  target: null,
  ...overrides,
});

describe("sidebar-visibility storage helpers", () => {
  it("reads and writes sidebarHidden safely", () => {
    const storage = createMemoryStorage();
    assert.equal(readStoredSidebarHidden(storage), false);

    writeStoredSidebarHidden(true, storage);
    assert.equal(storage.getItem(SIDEBAR_HIDDEN_STORAGE_KEY), "true");
    assert.equal(readStoredSidebarHidden(storage), true);

    writeStoredSidebarHidden(false, storage);
    assert.equal(storage.getItem(SIDEBAR_HIDDEN_STORAGE_KEY), "false");
    assert.equal(readStoredSidebarHidden(storage), false);
  });

  it("handles null or throwing storage gracefully", () => {
    assert.equal(readStoredSidebarHidden(null), false);
    const brokenStorage = {
      getItem: () => {
        throw new Error("denied");
      },
      setItem: () => {
        throw new Error("denied");
      },
    };
    assert.equal(readStoredSidebarHidden(brokenStorage), false);
    assert.doesNotThrow(() => writeStoredSidebarHidden(true, brokenStorage));
  });
});

describe("isSidebarToggleShortcut", () => {
  it("matches Ctrl+B on Windows/Linux and Cmd+B on macOS", () => {
    assert.equal(isSidebarToggleShortcut(createShortcutEvent(), "win32"), true);
    assert.equal(
      isSidebarToggleShortcut(createShortcutEvent({ key: "B" }), "linux"),
      true
    );
    assert.equal(
      isSidebarToggleShortcut(
        createShortcutEvent({ ctrlKey: false, metaKey: true }),
        "darwin"
      ),
      true
    );
  });

  it("rejects wrong platform modifier, extra modifiers, repeats, or wrong keys", () => {
    assert.equal(
      isSidebarToggleShortcut(createShortcutEvent(), "darwin"),
      false
    );
    assert.equal(
      isSidebarToggleShortcut(
        createShortcutEvent({ ctrlKey: false, metaKey: true }),
        "win32"
      ),
      false
    );
    assert.equal(
      isSidebarToggleShortcut(createShortcutEvent({ altKey: true }), "win32"),
      false
    );
    assert.equal(
      isSidebarToggleShortcut(createShortcutEvent({ shiftKey: true }), "win32"),
      false
    );
    assert.equal(
      isSidebarToggleShortcut(createShortcutEvent({ repeat: true }), "win32"),
      false
    );
    assert.equal(
      isSidebarToggleShortcut(createShortcutEvent({ key: "k" }), "win32"),
      false
    );
  });

  it("ignores shortcuts fired inside editable elements", () => {
    assert.equal(
      isSidebarToggleShortcut(
        createShortcutEvent({ target: { tagName: "INPUT" } }),
        "win32"
      ),
      false
    );
    assert.equal(
      isSidebarToggleShortcut(
        createShortcutEvent({ target: { tagName: "textarea" } }),
        "win32"
      ),
      false
    );
    assert.equal(
      isSidebarToggleShortcut(
        createShortcutEvent({ target: { isContentEditable: true } }),
        "win32"
      ),
      false
    );
    assert.equal(
      isSidebarToggleShortcut(
        createShortcutEvent({
          target: {
            tagName: "DIV",
            closest: (selector: string) =>
              selector.includes(".monaco-editor") ? {} : null,
          },
        }),
        "win32"
      ),
      false
    );
  });
});

describe("windowSlice sidebar visibility", () => {
  let restoreStorage: (() => void) | null = null;

  afterEach(() => {
    restoreStorage?.();
    restoreStorage = null;
  });

  it("hydrates from localStorage and persists toggle/set actions", () => {
    const storage = createMemoryStorage({
      [SIDEBAR_HIDDEN_STORAGE_KEY]: "true",
    });
    const loaded = loadWindowSliceWithStorage(storage);
    restoreStorage = loaded.restore;

    let state = loaded.windowSlice.reducer(undefined, { type: "init" });
    assert.equal(state.isSidebarHidden, true);

    state = loaded.windowSlice.reducer(state, loaded.toggleSidebarHidden());
    assert.equal(state.isSidebarHidden, false);
    assert.equal(storage.getItem(SIDEBAR_HIDDEN_STORAGE_KEY), "false");

    state = loaded.windowSlice.reducer(state, loaded.setSidebarHidden(true));
    assert.equal(state.isSidebarHidden, true);
    assert.equal(storage.getItem(SIDEBAR_HIDDEN_STORAGE_KEY), "true");
  });
});
