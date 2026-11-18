import assert from "node:assert/strict";
import fs from "node:fs";
import { it } from "node:test";
import * as React from "react";
import { createRoot } from "react-dom/client";
import { JSDOM } from "jsdom";
import ts from "typescript";

for (const kind of ["library", "backups"] as const) {
  it(`${kind} ignores out-of-order refreshes and updates after unmount`, async () => {
    const dom = new JSDOM("<div id='root'></div>");
    const previous = new Map<string, PropertyDescriptor | undefined>();
    for (const [key, value] of Object.entries({
      window: dom.window,
      document: dom.window.document,
      IS_REACT_ACT_ENVIRONMENT: true,
    })) {
      previous.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
      Object.defineProperty(globalThis, key, { value, configurable: true });
    }
    const pending: ((value: unknown) => void)[] = [];
    const read = () => new Promise((resolve) => pending.push(resolve));
    const subscribe = () => () => {};
    Object.assign(dom.window, {
      electron: {
        getLibrary: read,
        getLudusaviLocalState: read,
        onLibraryBatchComplete: subscribe,
        onDownloadsUpdated: subscribe,
        onLudusaviStateChanged: subscribe,
      },
    });
    const sourcePath =
      kind === "library"
        ? "use-library.hook.ts"
        : "use-ludusavi-local-state.ts";
    const { outputText } = ts.transpileModule(
      fs.readFileSync(`src/big-picture/src/hooks/${sourcePath}`, "utf8"),
      { compilerOptions: { module: ts.ModuleKind.CommonJS } }
    );
    const exports: Record<string, unknown> = {};
    new Function("exports", "require", outputText)(exports, (name: string) =>
      name === "react" ? React : { IS_DESKTOP: true }
    );
    const useHook = (
      kind === "library" ? exports.useLibrary : exports.useLudusaviLocalState
    ) as () => {
      downloadLibrary: unknown;
      state: unknown;
      updateLibrary: () => Promise<void>;
      refresh: () => Promise<void>;
    };
    let current!: ReturnType<typeof useHook>;
    function Component() {
      current = useHook();
      return null;
    }
    const root = createRoot(document.getElementById("root")!);
    let unmounted = false;
    try {
      await React.act(async () => root.render(React.createElement(Component)));
      let refresh!: Promise<void>;
      await React.act(async () => {
        refresh =
          kind === "library" ? current.updateLibrary() : current.refresh();
      });
      const latest =
        kind === "library"
          ? [{ id: "newest", isConcealed: false }]
          : { busy: false };
      await React.act(async () => {
        pending[1](latest);
        await refresh;
      });
      await React.act(async () =>
        pending[0](kind === "library" ? [] : { busy: true })
      );
      assert.deepEqual(
        kind === "library" ? current.downloadLibrary : current.state,
        latest
      );
      await React.act(async () => {
        refresh =
          kind === "library" ? current.updateLibrary() : current.refresh();
      });
      await React.act(async () => root.unmount());
      unmounted = true;
      pending[2](latest);
      await refresh;
    } finally {
      if (!unmounted) await React.act(async () => root.unmount());
      dom.window.close();
      for (const [key, descriptor] of previous) {
        if (descriptor) Object.defineProperty(globalThis, key, descriptor);
        else Reflect.deleteProperty(globalThis, key);
      }
    }
  });
}
