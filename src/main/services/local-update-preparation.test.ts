import assert from "node:assert/strict";
import { test } from "node:test";
import { getUpdatePreparation } from "./local-update-preparation.ts";
const release = {
  tag: "v4.4.2",
  publishedAt: "2026-11-15T12:00:00Z",
  name: "",
  notes: "",
  url: "",
};
const url = "https://github.com/example/hydra/actions";
test("preparation is shared information, not a request to maintain a local fork", () => {
  assert.equal(
    getUpdatePreparation("v4.4.1", release, url, { state: "active" }).phase,
    "preparing"
  );
  assert.equal(
    getUpdatePreparation("v4.4.2", release, url, { state: "active" }).phase,
    "current"
  );
});
test("failed preparation remains visible without treating an old failure as a new one", () => {
  const run = {
    status: "completed",
    conclusion: "failure",
    created_at: "2026-11-15T13:00:00Z",
    html_url: url + "/runs/1",
  };
  assert.equal(
    getUpdatePreparation("v4.4.1", release, url, { state: "active" }, run)
      .phase,
    "failed"
  );
  assert.equal(
    getUpdatePreparation(
      "v4.4.1",
      release,
      url,
      { state: "active" },
      { ...run, created_at: "2026-11-14T12:00:00Z" }
    ).phase,
    "preparing"
  );
});
test("disabled automation and unavailable status are reported honestly", () => {
  assert.equal(
    getUpdatePreparation("v4.4.1", release, url, {
      state: "disabled_inactivity",
    }).phase,
    "disabled"
  );
  assert.equal(getUpdatePreparation("v4.4.1", release, url).phase, "unknown");
});

test("a published adapted update is available rather than perpetually preparing", () => {
  const custom = [{ ...release, tag: "v4.4.2-rev.1" }];
  assert.equal(
    getUpdatePreparation("v4.4.1", release, url, undefined, undefined, custom)
      .phase,
    "available"
  );
  assert.equal(
    getUpdatePreparation(
      "v4.4.2",
      release,
      url,
      { state: "active" },
      undefined,
      custom
    ).phase,
    "current"
  );
});
