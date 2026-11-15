/** On-demand entry point. Compilation/publication run on GitHub, not this PC. */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import {
  compareVersions,
  officialVersion,
} from "./automatic-upstream-release.mjs";

const execute = promisify(execFile);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const workflowName = "upstream-release-check.yml";
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export async function githubApi(endpoint, options = {}) {
  const args = [
    "api",
    "--hostname",
    "github.com",
    endpoint,
    "-H",
    "X-GitHub-Api-Version: 2026-03-10",
  ];
  if (options.method) args.push("--method", options.method);
  if (options.body) args.push("--input", "-");
  const operation = execute("gh", args, {
    cwd: root,
    windowsHide: true,
    encoding: "utf8",
    timeout: 30_000,
    maxBuffer: 4 * 1024 * 1024,
  });
  operation.child.stdin?.end(
    options.body ? JSON.stringify(options.body) : undefined
  );
  try {
    const { stdout } = await operation;
    return stdout.trim() ? JSON.parse(stdout) : null;
  } catch (error) {
    if (options.allowMissing && /HTTP 404/.test(error.stderr ?? ""))
      return null;
    if (error.code === "ENOENT")
      throw new Error("Install GitHub CLI (gh), then run gh auth login once.");
    throw new Error(
      `GitHub request failed: ${error.stderr || error.message}\nCheck gh auth status and your access to this repository.`
    );
  }
}

export async function inspectRemoteUpdate(api, repository) {
  if (!/^[\w.-]+\/[\w.-]+$/.test(repository))
    throw new Error("Invalid project repository.");
  const repo = await api(`repos/${repository}`);
  const branch = repo.default_branch;
  if (!branch) throw new Error("The GitHub project has no default branch.");
  const file = await api(
    `repos/${repository}/contents/src/shared/local-edition.json?ref=${encodeURIComponent(branch)}`
  );
  if (file.encoding !== "base64")
    throw new Error("Could not read the project's edition settings.");
  const edition = JSON.parse(
    Buffer.from(file.content, "base64").toString("utf8")
  );
  if (
    edition.repository.toLowerCase() !== repository.toLowerCase() ||
    !/^[\w.-]+\/[\w.-]+$/.test(edition.upstreamRepository)
  )
    throw new Error("The online edition settings do not match this project.");
  const official = await api(
    `repos/${edition.upstreamRepository}/releases/latest`
  );
  if (official.draft || official.prerelease)
    throw new Error("The official release is not stable.");
  const version = officialVersion(official.tag_name);
  const releaseTag = `v${version}-remix.1`;
  const newer = compareVersions(official.tag_name, edition.upstreamTag) > 0;
  const published = newer
    ? await api(`repos/${repository}/releases/tags/${releaseTag}`, {
        allowMissing: true,
      })
    : null;
  return {
    repository,
    branch,
    upstreamTag: official.tag_name,
    baseTag: edition.upstreamTag,
    releaseTag,
    version: `${version}-remix.1`,
    phase: !newer
      ? "current"
      : published && !published.draft
        ? "sync"
        : "build",
  };
}

export function verifyPublishedRelease(release, plan) {
  if (
    !release ||
    release.draft ||
    release.prerelease ||
    release.tag_name !== plan.releaseTag
  )
    throw new Error(
      "The workflow finished, but the expected public release is unavailable."
    );
  const installer = `hydra-ludusavi-${plan.version}-setup.exe`;
  for (const name of [installer, `${installer}.blockmap`, "latest.yml"])
    if (
      !release.assets?.some(
        (asset) =>
          asset.name === name && asset.state === "uploaded" && asset.size > 0
      )
    )
      throw new Error(
        `The published release is missing a completed asset: ${name}`
      );
  return release.html_url;
}

export async function updateFromOfficial(options = {}, dependencies = {}) {
  const api = dependencies.api || githubApi;
  const log = dependencies.log || console.log;
  const pause = dependencies.sleep || sleep;
  const uuid = dependencies.uuid || randomUUID;
  const now = dependencies.now || Date.now;
  const repository =
    dependencies.repository ||
    JSON.parse(
      fs.readFileSync(path.join(root, "src/shared/local-edition.json"), "utf8")
    ).repository;
  const deadline = now() + 4 * 60 * 60_000;
  let result;
  for (let attempt = 0; attempt < 3; attempt++) {
    const plan = await inspectRemoteUpdate(api, repository);
    log(
      `Project: ${repository}\nOfficial release: ${plan.upstreamTag}\nOnline project base: ${plan.baseTag}`
    );
    if (plan.phase === "current") {
      log(
        result
          ? `Finished. Project and release: ${result.url}`
          : "Already up to date. No build or publication needed."
      );
      return result || { phase: "current", ...plan };
    }
    if (options.check) {
      log(
        plan.phase === "sync"
          ? "An update is already published; source synchronization is pending."
          : "A new official release can be adapted, built, and published on GitHub."
      );
      log(
        "Check only: no workflow was started and no GitHub files were changed."
      );
      return { ...plan, phase: "checked", action: plan.phase };
    }
    log(
      plan.phase === "sync"
        ? "Finishing source synchronization for an already published update."
        : "Requesting source adaptation, checks, Windows compilation, and a public release on GitHub."
    );
    const workflow = `repos/${repository}/actions/workflows/${workflowName}`;
    const settings = await api(workflow);
    if (settings.state === "disabled_inactivity") {
      await api(`${workflow}/enable`, { method: "PUT" });
      log("Re-enabled the workflow after GitHub's inactivity pause.");
    } else if (settings.state !== "active") {
      throw new Error(
        "The update workflow was disabled deliberately. Enable it in GitHub Actions before running this command."
      );
    }
    const runsPath = `${workflow}/runs?branch=${encodeURIComponent(plan.branch)}&per_page=30`;
    const runs = (await api(runsPath)).workflow_runs || [];
    let run = runs.find(
      (item) =>
        item.head_branch === plan.branch &&
        ["queued", "in_progress", "waiting", "pending", "requested"].includes(
          item.status
        )
    );
    if (run) log("An update check is already running; following that run.");
    else {
      const requestId = uuid();
      const dispatched = await api(`${workflow}/dispatches`, {
        method: "POST",
        body: { ref: plan.branch, inputs: { request_id: requestId } },
      });
      if (dispatched?.workflow_run_id) run = { id: dispatched.workflow_run_id };
      // Older GitHub dispatch responses contain no run ID. Correlate the exact
      // request instead of accidentally following another person's run.
      for (let poll = 0; !run && poll < 12; poll++) {
        await pause(5000);
        run = ((await api(runsPath)).workflow_runs || []).find(
          (item) =>
            item.head_branch === plan.branch &&
            item.display_title === `Official Hydra update ${requestId}`
        );
      }
      if (!run)
        throw new Error(
          `Update requested, but its run is not visible yet. Check https://github.com/${repository}/actions/workflows/${workflowName} before retrying.`
        );
    }
    const url = `https://github.com/${repository}/actions/runs/${run.id}`;
    log(`Update progress: ${url}`);
    if (options.noWait) return { phase: "started", url, runId: run.id };
    let previousStatus;
    let lastProgress = 0;
    for (;;) {
      if (now() > deadline)
        throw new Error(
          `Stopped waiting. The GitHub run may still be active: ${url}`
        );
      const progress = await api(`repos/${repository}/actions/runs/${run.id}`);
      if (
        progress.status !== previousStatus ||
        now() - lastProgress >= 60_000
      ) {
        log(
          `GitHub update: ${progress.status}${progress.conclusion ? ` (${progress.conclusion})` : ""}`
        );
        previousStatus = progress.status;
        lastProgress = now();
      }
      if (progress.status === "completed") {
        if (progress.conclusion !== "success")
          throw new Error(
            `The update did not finish successfully: ${url}\nReview the failed step. Re-running can finish source synchronization after a successful publication.`
          );
        break;
      }
      await pause(15_000);
    }
    const release = await api(
      `repos/${repository}/releases/tags/${plan.releaseTag}`,
      { allowMissing: true }
    );
    // An older active run may have finished just before another official
    // release appeared. Recheck remotely and request that newer update too.
    if (!release) {
      log("No release for the observed official version yet; checking again.");
      continue;
    }
    const releaseUrl = verifyPublishedRelease(release, plan);
    const updated = await inspectRemoteUpdate(api, repository);
    if (compareVersions(updated.baseTag, plan.upstreamTag) < 0)
      throw new Error(
        `Release published, but source synchronization is incomplete. Re-run to finish it. ${releaseUrl}`
      );
    result = { phase: "complete", url: releaseUrl, runUrl: url };
    if (updated.phase === "current") {
      log(`Finished. Project and release: ${releaseUrl}`);
      return result;
    }
  }
  throw new Error(
    "Official releases changed repeatedly while updating. Run the command again to check the newest version."
  );
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
) {
  try {
    const args = process.argv.slice(2);
    if (args.some((arg) => !["--check", "--no-wait", "--help"].includes(arg)))
      throw new Error("Use --check, --no-wait, or --help.");
    if (args.includes("--help"))
      console.log(
        "node scripts/update-from-official.mjs [--check | --no-wait]\nDefault: update and wait for the verified GitHub release.\n--check: read online state only.\n--no-wait: request the update and print its progress link.\nRequires Node.js and GitHub CLI authenticated with Actions write access. Compilation runs on GitHub."
      );
    else
      await updateFromOfficial({
        check: args.includes("--check"),
        noWait: args.includes("--no-wait"),
      });
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
