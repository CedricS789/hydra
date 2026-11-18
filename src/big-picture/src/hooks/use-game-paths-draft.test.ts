import assert from "node:assert/strict";
import fs from "node:fs";
import { it } from "node:test";
import * as React from "react";
import { createRoot } from "react-dom/client";
import { JSDOM } from "jsdom";
import ts from "typescript";
import type { LudusaviGameSettings } from "@types";

it("loads existing paths, isolates games, and becomes clean when edits are undone", async () => {
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
  const { outputText } = ts.transpileModule(
    fs.readFileSync(
      "src/big-picture/src/hooks/use-game-paths-draft.ts",
      "utf8"
    ),
    {
      compilerOptions: { module: ts.ModuleKind.CommonJS },
    }
  );
  const exports: Record<string, unknown> = {};
  new Function("exports", "require", outputText)(exports, () => React);
  type Draft = {
    savePathsText: string;
    trackingPathsText: string;
    setSavePathsText: (text: string) => void;
    discardPaths: () => void;
  };
  const useDraft = exports.useGamePathsDraft as (
    key: string,
    saved: LudusaviGameSettings
  ) => Draft;
  const saved = {
    enabled: true,
    savePaths: ["C:/saves/a"],
    trackingPaths: ["C:/a.exe"],
  };
  let key = "A";
  let current!: Draft;
  function Component() {
    current = useDraft(
      key,
      key === "A"
        ? saved
        : { enabled: true, savePaths: ["C:/saves/b"], trackingPaths: [] }
    );
    return null;
  }
  const root = createRoot(document.getElementById("root")!);
  try {
    await React.act(async () => root.render(React.createElement(Component)));
    assert.equal(current.savePathsText, "C:/saves/a");
    await React.act(async () => current.setSavePathsText("C:/edited"));
    assert.equal(current.savePathsText, "C:/edited");
    await React.act(async () => current.setSavePathsText("C:/saves/a"));
    assert.equal(current.savePathsText, saved.savePaths.join("\n"));
    await React.act(async () => current.setSavePathsText("C:/edited"));
    key = "B";
    await React.act(async () => root.render(React.createElement(Component)));
    assert.equal(current.savePathsText, "C:/saves/b");
    assert.equal(current.trackingPathsText, "");
    await React.act(async () => current.discardPaths());
    key = "A";
    await React.act(async () => root.render(React.createElement(Component)));
    assert.equal(current.savePathsText, "C:/saves/a");
  } finally {
    await React.act(async () => root.unmount());
    dom.window.close();
    for (const [key, descriptor] of previous) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
  }
});
