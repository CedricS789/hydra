import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  getClosestVerticalEdge,
  getReorderFinishIndex,
  moveOrderItem,
  reorderWebsiteOrder,
} from "./source-website-order.js";

describe("source-website-order", () => {
  it("detects top and bottom edges from row midpoint", () => {
    const rect = { top: 100, height: 40 };
    assert.equal(getClosestVerticalEdge(rect, 100), "top");
    assert.equal(getClosestVerticalEdge(rect, 119), "top");
    assert.equal(getClosestVerticalEdge(rect, 120), "bottom");
    assert.equal(getClosestVerticalEdge(rect, 140), "bottom");
  });

  it("computes finish index when dragging forward or backward", () => {
    assert.equal(
      getReorderFinishIndex({ startIndex: 0, targetIndex: 1, edge: "top" }),
      0
    );
    assert.equal(
      getReorderFinishIndex({ startIndex: 0, targetIndex: 1, edge: "bottom" }),
      1
    );
    assert.equal(
      getReorderFinishIndex({ startIndex: 0, targetIndex: 3, edge: "top" }),
      2
    );
    assert.equal(
      getReorderFinishIndex({ startIndex: 0, targetIndex: 3, edge: "bottom" }),
      3
    );
    assert.equal(
      getReorderFinishIndex({ startIndex: 3, targetIndex: 2, edge: "bottom" }),
      3
    );
    assert.equal(
      getReorderFinishIndex({ startIndex: 3, targetIndex: 1, edge: "top" }),
      1
    );
    assert.equal(
      getReorderFinishIndex({ startIndex: 3, targetIndex: 1, edge: "bottom" }),
      2
    );
  });

  it("reorders website ids accurately and ignores no-op drops", () => {
    const list = ["steam", "steamrip", "fitgirl", "dodi"];

    assert.deepEqual(reorderWebsiteOrder(list, "steam", "fitgirl", "bottom"), [
      "steamrip",
      "fitgirl",
      "steam",
      "dodi",
    ]);
    assert.deepEqual(reorderWebsiteOrder(list, "dodi", "steam", "top"), [
      "dodi",
      "steam",
      "steamrip",
      "fitgirl",
    ]);
    assert.deepEqual(
      reorderWebsiteOrder(list, "steam", "steamrip", "top"),
      list
    );
    assert.deepEqual(
      reorderWebsiteOrder(list, "dodi", "fitgirl", "bottom"),
      list
    );
    assert.deepEqual(
      reorderWebsiteOrder(list, "fitgirl", "fitgirl", "top"),
      list
    );
  });

  it("moves items by index safely", () => {
    const list = ["steam", "steamrip", "fitgirl"];
    assert.deepEqual(moveOrderItem(list, 1, 0), [
      "steamrip",
      "steam",
      "fitgirl",
    ]);
    assert.deepEqual(moveOrderItem(list, 1, 2), [
      "steam",
      "fitgirl",
      "steamrip",
    ]);
    assert.deepEqual(moveOrderItem(list, 0, -1), list);
    assert.deepEqual(moveOrderItem(list, 2, 3), list);
  });
});
