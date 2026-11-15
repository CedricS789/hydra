/** Prepare tested upstream-based releases for every installed copy.
 * This controller uses only Node built-ins and Git/GitHub CLI. Build jobs have
 * read-only credentials; only the separate publication job can publish/push.
 */
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import { createHash } from "node:crypto";

function run(command, args, cwd, options = {}) {
  const result = spawnSync(command, args, {
    cwd,
    encoding: "utf8",
    windowsHide: true,
    maxBuffer: 64 * 1024 * 1024,
    ...options,
  });
  if (result.error) throw result.error;
  if (result.status !== 0)
    throw new Error(`${command} failed: ${result.stderr || result.stdout}`);
  return result.stdout.trim();
}
const git = (root, ...args) => run("git", args, root);
const read = (root, file) =>
  JSON.parse(fs.readFileSync(path.join(root, file), "utf8"));
const write = (root, file, value) => {
  fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
  fs.writeFileSync(
    path.join(root, file),
    JSON.stringify(value, null, 2) + "\n"
  );
};
const digest = (file, algorithm = "sha256") =>
  createHash(algorithm).update(fs.readFileSync(file)).digest("hex");
const sha = (value) => /^[0-9a-f]{40}$/.test(value);
export function officialVersion(tag) {
  const match = /^v?(\d+)\.(\d+)\.(\d+)$/.exec(tag);
  if (!match || match.slice(1).some((n) => !Number.isSafeInteger(Number(n))))
    throw new Error("Only stable official x.y.z release tags are supported.");
  return match.slice(1).map(Number).join(".");
}
export function compareVersions(a, b) {
  const av = officialVersion(a).split(".").map(Number);
  const bv = officialVersion(b).split(".").map(Number);
  return av.reduce((result, n, i) => result || Math.sign(n - bv[i]), 0);
}
const missing = Symbol("missing");
const same = (a, b) => a === b || JSON.stringify(a) === JSON.stringify(b);
export function mergeJson(base, ours, theirs, location = "package.json") {
  if (same(ours, theirs)) return ours;
  if (same(base, ours)) return theirs;
  if (same(base, theirs)) return ours;
  const object = (v) =>
    v !== null && typeof v === "object" && !Array.isArray(v);
  if ([base, ours, theirs].every(object)) {
    return Object.fromEntries(
      [
        ...new Set([
          ...Object.keys(base),
          ...Object.keys(ours),
          ...Object.keys(theirs),
        ]),
      ].flatMap((key) => {
        const value = mergeJson(
          Object.hasOwn(base, key) ? base[key] : missing,
          Object.hasOwn(ours, key) ? ours[key] : missing,
          Object.hasOwn(theirs, key) ? theirs[key] : missing,
          `${location}.${key}`
        );
        return value === missing ? [] : [[key, value]];
      })
    );
  }
  throw new Error(
    `Automatic adaptation stopped: conflicting changes in ${location}`
  );
}

function gh(root, args, allowMissing = false) {
  const result = spawnSync("gh", args, {
    cwd: root,
    encoding: "utf8",
    windowsHide: true,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    if (allowMissing && /HTTP 404/.test(result.stderr)) return null;
    throw new Error(`GitHub request failed: ${result.stderr}`);
  }
  return result.stdout.trim() ? JSON.parse(result.stdout) : null;
}
function output(values) {
  if (process.env.GITHUB_OUTPUT)
    fs.appendFileSync(
      process.env.GITHUB_OUTPUT,
      Object.entries(values)
        .map(([k, v]) => `${k}=${v}`)
        .join("\n") + "\n"
    );
  console.log(JSON.stringify(values));
}

export function choosePlan(release, baseTag, published) {
  if (release.draft || release.prerelease)
    throw new Error("Official release is not stable.");
  officialVersion(release.tag_name);
  return compareVersions(release.tag_name, baseTag) <= 0
    ? "current"
    : published && !published.draft
      ? "sync"
      : "build";
}

export async function plan(root) {
  const edition = read(root, "src/shared/local-edition.json");
  const release = gh(root, [
    "api",
    `repos/${edition.upstreamRepository}/releases/latest`,
  ]);
  if (release.draft || release.prerelease)
    throw new Error("Official release is not stable.");
  const version = officialVersion(release.tag_name);
  const newer = compareVersions(release.tag_name, edition.upstreamTag) > 0;
  const tag = `v${version}-rev.1`;
  const published = newer
    ? gh(
        root,
        ["api", `repos/${edition.repository}/releases/tags/${tag}`],
        true
      )
    : null;
  const phase = choosePlan(release, edition.upstreamTag, published);
  output({
    phase,
    upstream_tag: release.tag_name,
    release_tag: tag,
    repository: edition.repository,
    branch:
      process.env.GITHUB_REF_NAME || git(root, "branch", "--show-current"),
    base_sha: git(root, "rev-parse", "HEAD"),
  });
}

export function prepare(root, tag, upstreamSha) {
  if (!sha(upstreamSha)) throw new Error("Invalid official source revision.");
  const version = officialVersion(tag);
  const original = git(root, "rev-parse", "HEAD");
  if (git(root, "status", "--porcelain"))
    throw new Error("Preparation requires a clean checkout.");
  const edition = read(root, "src/shared/local-edition.json");
  const previousPackage = read(root, "package.json");
  if (compareVersions(tag, edition.upstreamTag) <= 0)
    throw new Error(
      "The candidate must be newer than the recorded official base."
    );
  const officialPackage = JSON.parse(
    git(root, "show", `${upstreamSha}:package.json`)
  );
  if (officialPackage.version !== version)
    throw new Error("Official tag and package version disagree.");
  git(root, "merge-base", "--is-ancestor", edition.upstreamTag, upstreamSha);
  const result = spawnSync(
    "git",
    ["merge", "--no-commit", "--no-ff", "--no-edit", upstreamSha],
    { cwd: root, encoding: "utf8", windowsHide: true }
  );
  if (result.error) throw result.error;
  // Workflow definitions remain controlled by the customization branch, never
  // replaced by upstream automation. The fork's README is also separately owned.
  git(
    root,
    "restore",
    `--source=${original}`,
    "--staged",
    "--worktree",
    "--",
    ".github/workflows",
    "README.md"
  );
  const conflicts = git(root, "diff", "--name-only", "--diff-filter=U")
    .split("\n")
    .filter(Boolean);
  if (conflicts.includes("package.json")) {
    const stages = [1, 2, 3].map((n) =>
      JSON.parse(git(root, "show", `:${n}:package.json`))
    );
    // Our identity/version are metadata; dependency conflicts must never be
    // resolved by blindly preferring either side.
    for (const key of [
      "name",
      "version",
      "description",
      "repository",
      "author",
    ])
      for (const value of stages) {
        if (key in previousPackage) value[key] = previousPackage[key];
        else delete value[key];
      }
    write(root, "package.json", mergeJson(...stages));
    git(root, "add", "--", "package.json");
  }
  const unresolved = git(root, "diff", "--name-only", "--diff-filter=U");
  if (unresolved)
    throw new Error(
      `Automatic adaptation stopped; source conflicts:\n${unresolved}`
    );
  if (
    result.status !== 0 &&
    !fs.existsSync(path.join(root, ".git", "MERGE_HEAD"))
  )
    throw new Error(`Could not merge official source: ${result.stderr}`);
  const pkg = read(root, "package.json");
  for (const key of ["name", "description", "repository", "author"])
    if (key in previousPackage) pkg[key] = previousPackage[key];
  pkg.version = `${version}-rev.1`;
  write(root, "package.json", pkg);
  const currentEdition = read(root, "src/shared/local-edition.json");
  Object.assign(currentEdition, edition, {
    upstreamTag: tag,
    releaseTag: `v${pkg.version}`,
  });
  write(root, "src/shared/local-edition.json", currentEdition);
  for (const file of [
    "README.md",
    "docs/LOCAL-EDITION.md",
    "docs/LOCAL-RELEASE-NOTES.md",
  ]) {
    const filename = path.join(root, file);
    if (fs.existsSync(filename))
      fs.writeFileSync(
        filename,
        fs
          .readFileSync(filename, "utf8")
          .replaceAll(previousPackage.version, pkg.version)
          .replaceAll(edition.upstreamTag, tag)
      );
  }
  verifyIntegration(root);
  git(root, "add", "--update");
  const date = git(root, "show", "-s", "--format=%cI", upstreamSha);
  run(
    "git",
    [
      "-c",
      "user.name=Hydra Ludusavi updates",
      "-c",
      "user.email=updates@users.noreply.github.com",
      "commit",
      "--no-gpg-sign",
      "-m",
      `chore: adapt official Hydra ${tag} automatically`,
    ],
    root,
    {
      env: {
        ...process.env,
        GIT_AUTHOR_DATE: date,
        GIT_COMMITTER_DATE: date,
        HUSKY: "0",
      },
    }
  );
  const manifest = {
    baseSha: original,
    sourceSha: git(root, "rev-parse", "HEAD"),
    upstreamSha,
    upstreamTag: tag,
    releaseTag: currentEdition.releaseTag,
    version: pkg.version,
    repository: edition.repository,
    branch:
      git(root, "branch", "--show-current") || process.env.GITHUB_REF_NAME,
  };
  write(root, ".tmp/upstream-candidate.json", manifest);
  return manifest;
}

export function verifyIntegration(root) {
  const edition = read(root, "src/shared/local-edition.json");
  if (
    edition.displayName !== "Hydra Ludusavi" ||
    !edition.hideHydraPoints ||
    !edition.hideCloudPromotions
  )
    throw new Error("Custom display settings were not preserved.");
  const required = {
    "src/main/services/process-watcher.ts": /await observeLudusaviLocalGames\(/,
    "src/main/events/index.ts": /import ["']\.\/local-edition["']/,
    "src/main/index.ts": /owner: localEdition\.repository/,
    "src/renderer/src/pages/settings/settings.tsx": /SettingsLudusavi/,
  };
  for (const [file, pattern] of Object.entries(required))
    if (!pattern.test(fs.readFileSync(path.join(root, file), "utf8")))
      throw new Error(`Required integration is missing: ${file}`);
}

export function stage(root) {
  const manifest = read(root, ".tmp/upstream-candidate.json");
  if (
    git(root, "rev-parse", "HEAD") !== manifest.sourceSha ||
    git(root, "status", "--porcelain")
  )
    throw new Error(
      "The tested candidate source was changed during the build."
    );
  const destination = path.join(root, ".tmp/automatic-release");
  fs.mkdirSync(destination, { recursive: true });
  const installer = `hydra-ludusavi-${manifest.version}-setup.exe`;
  const files = [
    installer,
    `${installer}.blockmap`,
    "latest.yml",
  ];
  for (const file of files)
    fs.copyFileSync(
      path.join(root, "dist", file),
      path.join(destination, file)
    );
  git(
    root,
    "bundle",
    "create",
    path.join(destination, "source.bundle"),
    "HEAD",
    `^${manifest.baseSha}`
  );
  manifest.files = [...files, "source.bundle"].map((name) => ({
    name,
    sha256: digest(path.join(destination, name)),
    bytes: fs.statSync(path.join(destination, name)).size,
  }));
  write(root, ".tmp/automatic-release/candidate.json", manifest);
  fs.writeFileSync(
    path.join(destination, "release-notes.md"),
    `# Hydra Ludusavi ${manifest.version}\n\nAutomatically adapted from [official Hydra ${manifest.upstreamTag}](https://github.com/hydralauncher/hydra/releases/tag/${manifest.upstreamTag}).\n\n` +
      "This update is for every installed copy. No local clone, source merge, or compilation is required. Source adaptation, automated checks, native loading, and packaging completed before publication.\n\n" +
      "Save backups remain powered by Ludusavi. Local completion does not verify OneDrive upload completion. Automatic restoration remains disabled.\n"
  );
  verifyAssets(destination, manifest);
}

export function verifyAssets(folder, manifest) {
  const expected = [
    `hydra-ludusavi-${manifest.version}-setup.exe`,
    `hydra-ludusavi-${manifest.version}-setup.exe.blockmap`,
    "latest.yml",
    "source.bundle",
  ];
  if (
    manifest.files?.length !== expected.length ||
    !expected.every((name) => manifest.files.some((f) => f.name === name))
  )
    throw new Error("Incomplete release artifacts.");
  for (const file of manifest.files) {
    if (
      path.basename(file.name) !== file.name ||
      !sha(manifest.sourceSha) ||
      !sha(manifest.baseSha)
    )
      throw new Error("Invalid release manifest.");
    const filename = path.join(folder, file.name);
    if (
      fs.statSync(filename).size !== file.bytes ||
      digest(filename) !== file.sha256
    )
      throw new Error(`Release artifact changed: ${file.name}`);
  }
  const yaml = fs.readFileSync(path.join(folder, "latest.yml"), "utf8");
  if (
    !yaml.split(/\r?\n/).includes(`version: ${manifest.version}`) ||
    !yaml.includes(`path: ${expected[0]}`)
  )
    throw new Error("Updater metadata does not match this installer.");
  const hash = createHash("sha512")
    .update(fs.readFileSync(path.join(folder, expected[0])))
    .digest("base64");
  if (!yaml.includes(`sha512: ${hash}`))
    throw new Error("Installer and updater checksum disagree.");
}

function checkCandidate(root, manifest) {
  if (
    !sha(manifest.sourceSha) ||
    !sha(manifest.baseSha) ||
    !sha(manifest.upstreamSha)
  )
    throw new Error("Invalid candidate source revision.");
  const edition = read(root, "src/shared/local-edition.json");
  if (
    manifest.repository !== edition.repository ||
    manifest.baseSha !== git(root, "rev-parse", "HEAD")
  )
    throw new Error(
      "Candidate was built for a different controller revision or repository."
    );
  const candidate = JSON.parse(
    git(root, "show", `${manifest.sourceSha}:src/shared/local-edition.json`)
  );
  if (
    candidate.repository !== edition.repository ||
    candidate.upstreamTag !== manifest.upstreamTag ||
    candidate.releaseTag !== manifest.releaseTag ||
    candidate.releaseTag !== `v${manifest.version}`
  )
    throw new Error("Candidate identity does not match the tested release.");
  git(
    root,
    "merge-base",
    "--is-ancestor",
    manifest.baseSha,
    manifest.sourceSha
  );
  git(
    root,
    "merge-base",
    "--is-ancestor",
    manifest.upstreamSha,
    manifest.sourceSha
  );
  if (
    git(
      root,
      "diff",
      "--name-only",
      manifest.baseSha,
      manifest.sourceSha,
      "--",
      ".github/workflows"
    )
  )
    throw new Error("Candidate attempted to alter the controlling workflows.");
}

export function publish(root, folder, transport = {}) {
  const github = transport.github || gh;
  const releaseCommand = transport.releaseCommand || run;
  const manifest = read(folder, "candidate.json");
  verifyAssets(folder, manifest);
  if (process.env.GITHUB_REF_NAME !== manifest.branch)
    throw new Error("Publication branch changed.");
  git(root, "fetch", path.join(folder, "source.bundle"), "HEAD");
  checkCandidate(root, manifest);
  const remote = git(
    root,
    "ls-remote",
    "origin",
    `refs/heads/${manifest.branch}`
  ).split(/\s/)[0];
  if (remote !== manifest.baseSha)
    throw new Error(
      "Source changed while the update was being built. Retry from the new source."
    );
  const args = ["--repo", manifest.repository];
  const existing = github(
    root,
    [
      "api",
      `repos/${manifest.repository}/releases/tags/${manifest.releaseTag}`,
    ],
    true
  );
  if (existing && !existing.draft)
    throw new Error(
      "A published release already exists; it will not be replaced."
    );
  if (existing && existing.target_commitish !== manifest.sourceSha)
    throw new Error("An existing draft belongs to another source revision.");
  const archiveBranch = `automatic/releases/${manifest.releaseTag}`;
  git(
    root,
    "push",
    "origin",
    `${manifest.sourceSha}:refs/heads/${archiveBranch}`
  );
  if (!existing)
    releaseCommand(
      "gh",
      [
        "release",
        "create",
        manifest.releaseTag,
        ...args,
        "--draft",
        "--target",
        manifest.sourceSha,
        "--title",
        `Hydra Ludusavi ${manifest.version}`,
        "--notes-file",
        path.join(folder, "release-notes.md"),
      ],
      root
    );
  releaseCommand(
    "gh",
    [
      "release",
      "upload",
      manifest.releaseTag,
      ...args,
      "--clobber",
      ...manifest.files
        .filter((f) => f.name !== "source.bundle")
        .map((f) => path.join(folder, f.name)),
      path.join(folder, "candidate.json"),
    ],
    root
  );
  releaseCommand(
    "gh",
    [
      "release",
      "edit",
      manifest.releaseTag,
      ...args,
      "--draft=false",
      "--prerelease=false",
      "--latest",
    ],
    root
  );
  // A failed final push is recoverable: the next check detects the published
  // release and retries only the fast-forward, without rebuilding/replacing it.
  git(
    root,
    "push",
    "origin",
    `${manifest.sourceSha}:refs/heads/${manifest.branch}`
  );
}

export function syncPublished(root, tag) {
  const edition = read(root, "src/shared/local-edition.json");
  const release = gh(root, [
    "api",
    `repos/${edition.repository}/releases/tags/${tag}`,
  ]);
  if (release.draft || release.prerelease || !sha(release.target_commitish))
    throw new Error(
      "No completed automatic release is available for synchronization."
    );
  git(root, "fetch", "origin", `refs/tags/${tag}`);
  const candidate = git(root, "rev-parse", "FETCH_HEAD^{commit}");
  if (candidate !== release.target_commitish)
    throw new Error("Release tag and source disagree.");
  const base = git(root, "rev-parse", "HEAD");
  const metadata = JSON.parse(
    git(root, "show", `${candidate}:src/shared/local-edition.json`)
  );
  officialVersion(metadata.upstreamTag);
  git(
    root,
    "fetch",
    "--no-tags",
    `https://github.com/${edition.upstreamRepository}.git`,
    `refs/tags/${metadata.upstreamTag}:refs/tags/${metadata.upstreamTag}`
  );
  checkCandidate(root, {
    baseSha: base,
    sourceSha: candidate,
    repository: edition.repository,
    upstreamSha: git(root, "rev-parse", `${metadata.upstreamTag}^{commit}`),
    upstreamTag: metadata.upstreamTag,
    releaseTag: tag,
    version: JSON.parse(git(root, "show", `${candidate}:package.json`)).version,
  });
  git(
    root,
    "push",
    "origin",
    `${candidate}:refs/heads/${process.env.GITHUB_REF_NAME}`
  );
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
) {
  try {
    const root = process.cwd();
    switch (process.argv[2]) {
      case "plan":
        await plan(root);
        break;
      case "prepare":
        console.log(
          JSON.stringify(
            prepare(root, process.env.UPSTREAM_TAG, process.env.UPSTREAM_SHA)
          )
        );
        break;
      case "stage":
        stage(root);
        break;
      case "publish":
        publish(root, path.join(root, ".tmp/automatic-release"));
        break;
      case "sync":
        syncPublished(root, process.env.RELEASE_TAG);
        break;
      case "verify":
        verifyIntegration(root);
        break;
      default:
        throw new Error(
          "Choose plan, prepare, verify, stage, publish, or sync."
        );
    }
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
