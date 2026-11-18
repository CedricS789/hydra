import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";

interface NavigationServiceInstance {
  registerRegion(region: {
    id: string;
    parentRegionId: string | null;
    orientation: "vertical" | "horizontal" | "grid";
    navigationOverrides?: Record<string, unknown>;
  }): () => void;
  registerNavigationNode(node: {
    id: string;
    regionId: string;
    navigationOverrides?: Record<string, unknown>;
    getElement: () => HTMLElement | null;
  }): () => void;
  setFocus(nodeId: string): string | null;
  moveFocus(direction: "up" | "down" | "left" | "right"): string | null;
}

const projectRoot = fileURLToPath(new URL("../../../../", import.meta.url));

function createRect(
  left: number,
  top: number,
  width: number,
  height: number
): DOMRect {
  return {
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
  } as DOMRect;
}

function createMockElement(rect: DOMRect) {
  return {
    getBoundingClientRect: () => rect,
  } as unknown as HTMLElement;
}

describe("NavigationService moveFocus precedence", () => {
  let tempDir: string;
  let NavigationServiceClass: new () => NavigationServiceInstance;

  before(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "hydra-navigation-service-"));
    const outfile = join(tempDir, "navigation.service.mjs");
    await build({
      entryPoints: [
        fileURLToPath(new URL("./navigation.service.ts", import.meta.url)),
      ],
      bundle: true,
      platform: "node",
      format: "esm",
      outfile,
      tsconfig: join(projectRoot, "tsconfig.web.json"),
      define: { "process.env.NODE_ENV": '"test"' },
    });
    const mod = await import(pathToFileURL(outfile).href);
    NavigationServiceClass = mod.NavigationService;
  });

  after(async () => {
    if (tempDir) {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it("navigates within nested horizontal and grid regions before falling back to ancestor overrides", () => {
    const navigation = new NavigationServiceClass();

    navigation.registerRegion({
      id: "shell",
      parentRegionId: null,
      orientation: "horizontal",
    });
    navigation.registerRegion({
      id: "sidebar",
      parentRegionId: "shell",
      orientation: "vertical",
    });
    navigation.registerNavigationNode({
      id: "sidebar-settings",
      regionId: "sidebar",
      getElement: () => createMockElement(createRect(0, 100, 120, 40)),
    });

    navigation.registerRegion({
      id: "content",
      parentRegionId: "shell",
      orientation: "vertical",
      navigationOverrides: {
        left: { type: "item", itemId: "sidebar-settings" },
      },
    });
    navigation.registerRegion({
      id: "page",
      parentRegionId: "content",
      orientation: "vertical",
    });
    navigation.registerNavigationNode({
      id: "lock-btn",
      regionId: "page",
      getElement: () => createMockElement(createRect(200, 40, 140, 40)),
    });

    navigation.registerRegion({
      id: "tools-grid",
      parentRegionId: "page",
      orientation: "grid",
    });

    const tools = [
      { id: "tool-1", rect: createRect(200, 100, 140, 40) },
      { id: "tool-2", rect: createRect(352, 100, 90, 40) },
      { id: "tool-3", rect: createRect(454, 100, 120, 40) },
      { id: "tool-4", rect: createRect(200, 152, 160, 40) },
      { id: "tool-5", rect: createRect(372, 152, 140, 40) },
    ];
    for (const tool of tools) {
      navigation.registerNavigationNode({
        id: tool.id,
        regionId: "tools-grid",
        getElement: () => createMockElement(tool.rect),
      });
    }

    navigation.registerRegion({
      id: "bottom-row",
      parentRegionId: "page",
      orientation: "horizontal",
    });
    navigation.registerNavigationNode({
      id: "row-left",
      regionId: "bottom-row",
      getElement: () => createMockElement(createRect(200, 220, 100, 40)),
    });
    navigation.registerNavigationNode({
      id: "row-right",
      regionId: "bottom-row",
      getElement: () => createMockElement(createRect(312, 220, 100, 40)),
    });

    navigation.setFocus("tool-1");
    assert.equal(navigation.moveFocus("right"), "tool-2");
    assert.equal(navigation.moveFocus("right"), "tool-3");
    assert.equal(navigation.moveFocus("left"), "tool-2");
    assert.equal(navigation.moveFocus("down"), "tool-5");
    assert.equal(navigation.moveFocus("left"), "tool-4");
    assert.equal(navigation.moveFocus("right"), "tool-5");
    assert.equal(navigation.moveFocus("left"), "tool-4");
    assert.equal(navigation.moveFocus("up"), "tool-1");

    // Up from row 1 exits the grid into the enclosing vertical region.
    assert.equal(navigation.moveFocus("up"), "lock-btn");
    assert.equal(navigation.moveFocus("down"), "tool-1");

    // Left at the left edge of the grid falls back to the ancestor content override.
    assert.equal(navigation.moveFocus("left"), "sidebar-settings");

    // HorizontalFocusGroup inside content also handles left internally first.
    navigation.setFocus("row-right");
    assert.equal(navigation.moveFocus("left"), "row-left");
    assert.equal(navigation.moveFocus("left"), "sidebar-settings");
  });

  it("evaluates region block override only after internal movement in that region has no candidate", () => {
    const navigation = new NavigationServiceClass();

    navigation.registerRegion({
      id: "root",
      parentRegionId: null,
      orientation: "vertical",
      navigationOverrides: {
        up: { type: "block" },
        down: { type: "block" },
      },
    });
    navigation.registerNavigationNode({
      id: "first",
      regionId: "root",
      getElement: () => createMockElement(createRect(0, 0, 100, 40)),
    });
    navigation.registerNavigationNode({
      id: "second",
      regionId: "root",
      getElement: () => createMockElement(createRect(0, 50, 100, 40)),
    });

    navigation.setFocus("second");
    assert.equal(navigation.moveFocus("up"), "first");
    assert.equal(navigation.moveFocus("up"), "first");
    assert.equal(navigation.moveFocus("down"), "second");
    assert.equal(navigation.moveFocus("down"), "second");
  });
});
