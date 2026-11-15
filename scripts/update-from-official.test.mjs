import assert from "node:assert/strict";
import { test } from "node:test";
import {
  inspectRemoteUpdate,
  updateFromOfficial,
  verifyPublishedRelease,
} from "./update-from-official.mjs";

const repository = "Fixture/hydra";
const branch = "custom/ludusavi-backups";
function completedRelease() {
  const exe = "hydra-ludusavi-4.4.2-rev.1-setup.exe";
  return {
    tag_name: "v4.4.2-rev.1",
    draft: false,
    prerelease: false,
    html_url: "https://github.com/Fixture/hydra/releases/tag/v4.4.2-rev.1",
    assets: [exe, `${exe}.blockmap`, "latest.yml"].map((name) => ({
      name,
      state: "uploaded",
      size: 1,
    })),
  };
}
function fixture(options = {}) {
  const calls = [],
    logs = [];
  let base = options.base || "v4.4.1",
    finished = false,
    dispatched = false,
    matches = 0;
  const api = async (endpoint, request = {}) => {
    calls.push({ endpoint, ...request });
    if (request.method === "PUT") return null;
    if (endpoint.endsWith("/dispatches")) {
      dispatched = true;
      return options.legacyResponse ? null : { workflow_run_id: 42 };
    }
    if (endpoint === `repos/${repository}`) return { default_branch: branch };
    if (endpoint.includes("/contents/src/shared/local-edition.json?")) {
      assert.match(endpoint, /ref=custom%2Fludusavi-backups/);
      return {
        encoding: "base64",
        content: Buffer.from(
          JSON.stringify({
            repository,
            upstreamRepository: "Official/hydra",
            upstreamTag: base,
          })
        ).toString("base64"),
      };
    }
    if (endpoint === "repos/Official/hydra/releases/latest")
      return {
        tag_name: "v4.4.2",
        draft: false,
        prerelease: false,
      };
    if (endpoint.includes("/releases/tags/"))
      return finished || options.published ? completedRelease() : null;
    if (endpoint.endsWith("upstream-release-check.yml"))
      return { state: options.state || "active" };
    if (endpoint.includes("/runs?")) {
      if (options.existing && !dispatched)
        return {
          workflow_runs: [
            { id: 42, status: "in_progress", head_branch: branch },
          ],
        };
      if (options.legacyResponse && dispatched) {
        matches++;
        return {
          workflow_runs: [
            {
              id: 99,
              head_branch: branch,
              display_title: "Official Hydra update unrelated",
              status: "completed",
            },
            ...(matches > 1
              ? [
                  {
                    id: 42,
                    head_branch: branch,
                    display_title: "Official Hydra update fixture-request",
                  },
                ]
              : []),
          ],
        };
      }
      return { workflow_runs: [] };
    }
    if (endpoint.endsWith("/actions/runs/42")) {
      if (options.fail) return { status: "completed", conclusion: "failure" };
      finished = true;
      if (!options.noSourceSync) base = "v4.4.2";
      return { status: "completed", conclusion: "success" };
    }
    throw new Error(`Unexpected endpoint: ${endpoint}`);
  };
  return {
    api,
    calls,
    logs,
    dependencies: {
      api,
      repository,
      log: (value) => logs.push(value),
      uuid: () => "fixture-request",
      sleep: async () => {},
    },
  };
}

test("already integrated online source does not start a build or publication", async () => {
  const f = fixture({ base: "v4.4.2" });
  const value = await updateFromOfficial({}, f.dependencies);
  assert.equal(value.phase, "current");
  assert.equal(
    f.calls.some((call) => call.method),
    false
  );
});

test("remote metadata determines the plan and recognizes an already published update", async () => {
  const f = fixture({ published: true });
  const value = await inspectRemoteUpdate(f.api, repository);
  assert.equal(value.baseTag, "v4.4.1");
  assert.equal(value.upstreamTag, "v4.4.2");
  assert.equal(value.phase, "sync");
  assert.equal(value.branch, branch);
});

test("check-only mode is read-only even when GitHub paused the workflow", async () => {
  const f = fixture({ state: "disabled_inactivity" });
  const value = await updateFromOfficial({ check: true }, f.dependencies);
  assert.equal(value.phase, "checked");
  assert.equal(value.action, "build");
  assert.equal(
    f.calls.some((call) => call.method),
    false
  );
});

test("one command dispatches, waits, and verifies both source and public installer assets", async () => {
  const f = fixture();
  const result = await updateFromOfficial({}, f.dependencies);
  assert.equal(result.phase, "complete");
  assert.match(result.url, /releases\/tag\/v4.4.2-rev.1$/);
  const requests = f.calls.filter((call) => call.method === "POST");
  assert.equal(requests.length, 1);
  assert.deepEqual(requests[0].body, {
    ref: branch,
    inputs: { request_id: "fixture-request" },
  });
});

test("an active update is followed without duplicate dispatch", async () => {
  const f = fixture({ existing: true });
  assert.equal(
    (await updateFromOfficial({}, f.dependencies)).phase,
    "complete"
  );
  assert.equal(
    f.calls.some((call) => call.method === "POST"),
    false
  );
});

test("an inactivity pause is resumed; a deliberate pause is respected", async () => {
  const inactive = fixture({ state: "disabled_inactivity" });
  assert.equal(
    (await updateFromOfficial({}, inactive.dependencies)).phase,
    "complete"
  );
  assert.equal(
    inactive.calls.filter((call) => call.method === "PUT").length,
    1
  );
  const deliberate = fixture({ state: "disabled_manually" });
  await assert.rejects(
    updateFromOfficial({}, deliberate.dependencies),
    /disabled deliberately/
  );
  assert.equal(
    deliberate.calls.some((call) => call.method),
    false
  );
});

test("older dispatch responses are correlated to this request, never an unrelated run", async () => {
  const f = fixture({ legacyResponse: true });
  const value = await updateFromOfficial({ noWait: true }, f.dependencies);
  assert.equal(value.phase, "started");
  assert.equal(value.runId, 42);
  assert.equal(
    f.calls.some((call) => call.endpoint.endsWith("/actions/runs/99")),
    false
  );
});

test("failed workflows and incomplete source sync cannot be reported as success", async () => {
  const failed = fixture({ fail: true });
  await assert.rejects(
    updateFromOfficial({}, failed.dependencies),
    /did not finish successfully/
  );
  const unsynced = fixture({ noSourceSync: true });
  await assert.rejects(
    updateFromOfficial({}, unsynced.dependencies),
    /synchronization is incomplete/
  );
});

test("release verification rejects drafts, unfinished assets, and missing metadata", () => {
  const plan = { releaseTag: "v4.4.2-rev.1", version: "4.4.2-rev.1" };
  assert.throws(
    () => verifyPublishedRelease({ ...completedRelease(), draft: true }, plan),
    /unavailable/
  );
  assert.throws(
    () => verifyPublishedRelease({ ...completedRelease(), assets: [] }, plan),
    /missing/
  );
  assert.throws(
    () =>
      verifyPublishedRelease(
        {
          ...completedRelease(),
          assets: completedRelease().assets.map((asset) => ({
            ...asset,
            state: "new",
          })),
        },
        plan
      ),
    /completed asset/
  );
});
