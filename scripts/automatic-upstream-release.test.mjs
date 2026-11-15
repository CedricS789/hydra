import assert from "node:assert/strict";
import { test } from "node:test";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import {
  choosePlan,
  compareVersions,
  officialVersion,
  mergeJson,
  prepare,
  stage,
  verifyAssets,
  verifyIntegration,
  publish,
} from "./automatic-upstream-release.mjs";

const git = (root, ...args) =>
  execFileSync("git", args, {
    cwd: root,
    encoding: "utf8",
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
const put = (root, name, value) => {
  const target = path.join(root, name);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(
    target,
    typeof value === "string" ? value : JSON.stringify(value, null, 2) + "\n"
  );
};
const read = (root, name) =>
  JSON.parse(fs.readFileSync(path.join(root, name), "utf8"));
function fixture(conflict = false) {
  const root = fs.mkdtempSync(
    path.join(process.cwd(), ".tmp", "automatic-update-test-")
  );
  git(root, "init", "-b", "main");
  git(root, "config", "user.name", "Fixture");
  git(root, "config", "user.email", "fixture@example.invalid");
  git(root, "config", "core.autocrlf", "false");
  put(root, ".gitignore", ".tmp/\n");
  put(root, "package.json", {
    name: "hydra",
    version: "4.4.1",
    dependencies: { original: "1" },
  });
  put(root, "README.md", "Official original\n");
  put(root, ".github/workflows/release.yml", "name: Official original\n");
  put(root, "code.ts", "original\n");
  git(root, "add", ".");
  git(root, "commit", "-m", "base");
  git(root, "tag", "v4.4.1");
  git(root, "checkout", "-b", "official-next");
  put(root, "package.json", {
    name: "hydra",
    version: "4.4.2",
    dependencies: { original: "2", added: "1" },
  });
  put(root, "README.md", "Official rewritten\n");
  put(root, ".github/workflows/release.yml", "name: Official replaced\n");
  if (conflict) put(root, "code.ts", "official change\n");
  put(root, "official-feature.ts", "new official functionality\n");
  git(root, "add", ".");
  git(root, "commit", "-m", "official release");
  git(root, "tag", "v4.4.2");
  const upstreamSha = git(root, "rev-parse", "HEAD");
  git(root, "checkout", "main");
  put(root, "package.json", {
    name: "hydralauncher-local",
    version: "4.4.1-remix.2",
    description: "Custom",
    dependencies: { original: "1" },
    devDependencies: { esbuild: "1" },
  });
  put(root, "README.md", "Custom 4.4.1-remix.2 based on v4.4.1\n");
  put(
    root,
    ".github/workflows/release.yml",
    "name: Controlled custom workflow\n"
  );
  put(root, "src/shared/local-edition.json", {
    displayName: "Hydra Ludusavi",
    fullName: "Hydra + Ludusavi Integrated",
    hideHydraPoints: true,
    hideCloudPromotions: true,
    repository: "Fixture/hydra",
    upstreamRepository: "Fixture/upstream",
    upstreamTag: "v4.4.1",
    releaseTag: "v4.4.1-remix.2",
  });
  put(
    root,
    "src/main/services/process-watcher.ts",
    "await observeLudusaviLocalGames(games, processes);\n"
  );
  put(root, "src/main/events/index.ts", 'import "./local-edition";\n');
  put(
    root,
    "src/main/index.ts",
    "owner: localEdition.repository.split('/')[0]\n"
  );
  put(
    root,
    "src/renderer/src/pages/settings/settings.tsx",
    "SettingsLudusavi\n"
  );
  if (conflict) put(root, "code.ts", "custom change\n");
  git(root, "add", ".");
  git(root, "commit", "-m", "custom application");
  return { root, upstreamSha, baseSha: git(root, "rev-parse", "HEAD") };
}

test("only newer stable official releases are built; completed releases resume source sync", () => {
  const release = { tag_name: "v4.4.2", draft: false, prerelease: false };
  assert.equal(choosePlan(release, "v4.4.1", null), "build");
  assert.equal(choosePlan(release, "v4.4.1", { draft: true }), "build");
  assert.equal(choosePlan(release, "v4.4.1", { draft: false }), "sync");
  assert.equal(choosePlan(release, "v4.4.2", null), "current");
  assert.equal(choosePlan(release, "v4.5.0", null), "current");
  assert.throws(() => choosePlan({ ...release, prerelease: true }, "v4.4.1"));
  assert.equal(compareVersions("v4.10.0", "v4.9.9"), 1);
  for (const value of ["v4.4.2-beta", "--help", "v4.4.2\nmalicious", "v4.4"])
    assert.throws(() => officialVersion(value));
});

test("JSON merging retains independent dependency additions and refuses competing edits", () => {
  assert.deepEqual(
    mergeJson(
      { dependencies: { a: "1" } },
      { dependencies: { a: "1", custom: "1" } },
      { dependencies: { a: "2" } }
    ),
    { dependencies: { a: "2", custom: "1" } }
  );
  assert.throws(
    () => mergeJson({ a: "1" }, { a: "2" }, { a: "3" }),
    /package.json.a/
  );
  assert.deepEqual(mergeJson({ a: "1" }, {}, { a: "1", b: "2" }), { b: "2" });
});

test("real Git adaptation preserves custom code and identity while importing official changes", () => {
  const { root, upstreamSha } = fixture();
  const manifest = prepare(root, "v4.4.2", upstreamSha);
  const pkg = read(root, "package.json");
  assert.equal(pkg.name, "hydralauncher-local");
  assert.equal(pkg.version, "4.4.2-remix.1");
  assert.deepEqual(pkg.dependencies, { original: "2", added: "1" });
  assert.deepEqual(pkg.devDependencies, { esbuild: "1" });
  assert.equal(
    read(root, "src/shared/local-edition.json").upstreamTag,
    "v4.4.2"
  );
  assert.match(
    fs.readFileSync(path.join(root, "README.md"), "utf8"),
    /Custom 4.4.2-remix.1 based on v4.4.2/
  );
  assert.equal(
    fs.readFileSync(path.join(root, ".github/workflows/release.yml"), "utf8"),
    "name: Controlled custom workflow\n"
  );
  assert.equal(fs.existsSync(path.join(root, "official-feature.ts")), true);
  assert.equal(git(root, "status", "--porcelain"), "");
  assert.equal(git(root, "rev-parse", "HEAD"), manifest.sourceSha);
});

test("a genuine source conflict stops before creating an update commit", () => {
  const { root, upstreamSha, baseSha } = fixture(true);
  assert.throws(() => prepare(root, "v4.4.2", upstreamSha), /source conflicts/);
  assert.equal(git(root, "rev-parse", "HEAD"), baseSha);
  assert.equal(
    fs.existsSync(path.join(root, ".tmp/upstream-candidate.json")),
    false
  );
});

test("missing watcher integration and tag/version mismatches are rejected", () => {
  const { root, upstreamSha, baseSha } = fixture();
  assert.throws(() => prepare(root, "v4.4.3", upstreamSha), /disagree/);
  assert.equal(git(root, "rev-parse", "HEAD"), baseSha);
  put(root, "src/main/services/process-watcher.ts", "// observer removed\n");
  assert.throws(() => verifyIntegration(root), /process-watcher/);
});

function stagedFixture() {
  const item = fixture();
  const manifest = prepare(item.root, "v4.4.2", item.upstreamSha);
  const exe = `hydra-ludusavi-${manifest.version}-setup.exe`;
  put(item.root, `dist/${exe}`, "synthetic installer bytes, not an executable");
  put(item.root, `dist/${exe}.blockmap`, "synthetic blockmap");
  const bytes = fs.readFileSync(path.join(item.root, "dist", exe));
  return import("node:crypto").then(({ createHash }) => {
    put(
      item.root,
      "dist/latest.yml",
      `version: ${manifest.version}\npath: ${exe}\nsha512: ${createHash("sha512").update(bytes).digest("base64")}\n`
    );
    // Real repositories ignore dist; the tiny fixture must do so as well.
    fs.appendFileSync(path.join(item.root, ".git/info/exclude"), "\ndist/\n");
    stage(item.root);
    return {
      ...item,
      manifest,
      folder: path.join(item.root, ".tmp/automatic-release"),
    };
  });
}

test("staged files and updater metadata are checked for exact contents", async () => {
  const { folder } = await stagedFixture();
  const manifest = read(folder, "candidate.json");
  verifyAssets(folder, manifest);
  fs.appendFileSync(path.join(folder, "latest.yml"), "tampered\n");
  assert.throws(() => verifyAssets(folder, manifest), /artifact changed/);
});

test("publication uses a draft, then assets, then public release, then fast-forwards the catalogue", async () => {
  const { root, manifest, folder, baseSha } = await stagedFixture();
  const bare = path.join(root, ".tmp", "remote.git");
  git(root, "init", "--bare", bare);
  git(root, "remote", "add", "origin", bare);
  git(root, "push", "origin", `${baseSha}:refs/heads/main`);
  git(root, "checkout", "--detach", baseSha);
  const previous = process.env.GITHUB_REF_NAME;
  process.env.GITHUB_REF_NAME = "main";
  const operations = [];
  try {
    publish(root, folder, {
      github: () => null,
      releaseCommand: (_cmd, args) => {
        operations.push(args[1]);
        // Publication must not advance the default branch before assets exist.
        assert.equal(
          git(root, "ls-remote", "origin", "refs/heads/main").split(/\s/)[0],
          baseSha
        );
      },
    });
    assert.deepEqual(operations, ["create", "upload", "edit"]);
    assert.equal(
      git(root, "ls-remote", "origin", "refs/heads/main").split(/\s/)[0],
      manifest.sourceSha
    );
  } finally {
    if (previous === undefined) delete process.env.GITHUB_REF_NAME;
    else process.env.GITHUB_REF_NAME = previous;
  }
});

test("published releases are never overwritten", async () => {
  const { root, folder, baseSha } = await stagedFixture();
  const bare = path.join(root, ".tmp", "remote.git");
  git(root, "init", "--bare", bare);
  git(root, "remote", "add", "origin", bare);
  git(root, "push", "origin", `${baseSha}:refs/heads/main`);
  git(root, "checkout", "--detach", baseSha);
  const previous = process.env.GITHUB_REF_NAME;
  process.env.GITHUB_REF_NAME = "main";
  try {
    assert.throws(
      () => publish(root, folder, { github: () => ({ draft: false }) }),
      /will not be replaced/
    );
    assert.equal(
      git(root, "ls-remote", "origin", "refs/heads/main").split(/\s/)[0],
      baseSha
    );
  } finally {
    if (previous === undefined) delete process.env.GITHUB_REF_NAME;
    else process.env.GITHUB_REF_NAME = previous;
  }
});

test("failed asset upload leaves the default source untouched and never publishes", async () => {
  const { root, folder, baseSha } = await stagedFixture();
  const bare = path.join(root, ".tmp", "remote.git");
  git(root, "init", "--bare", bare);
  git(root, "remote", "add", "origin", bare);
  git(root, "push", "origin", `${baseSha}:refs/heads/main`);
  git(root, "checkout", "--detach", baseSha);
  const previous = process.env.GITHUB_REF_NAME;
  process.env.GITHUB_REF_NAME = "main";
  const operations = [];
  try {
    assert.throws(
      () =>
        publish(root, folder, {
          github: () => null,
          releaseCommand: (_cmd, args) => {
            operations.push(args[1]);
            if (args[1] === "upload") throw Error("fixture upload interrupted");
          },
        }),
      /upload interrupted/
    );
    assert.deepEqual(operations, ["create", "upload"]);
    assert.equal(
      git(root, "ls-remote", "origin", "refs/heads/main").split(/\s/)[0],
      baseSha
    );
  } finally {
    if (previous === undefined) delete process.env.GITHUB_REF_NAME;
    else process.env.GITHUB_REF_NAME = previous;
  }
});

test("a changed catalogue revision rejects publication before any release operation", async () => {
  const { root, folder, baseSha } = await stagedFixture();
  const bare = path.join(root, ".tmp", "remote.git");
  git(root, "init", "--bare", bare);
  git(root, "remote", "add", "origin", bare);
  git(root, "checkout", "--detach", baseSha);
  put(root, "new-custom-change.txt", "independent customization\n");
  git(root, "add", ".");
  git(root, "commit", "-m", "new controller revision");
  git(root, "push", "origin", "HEAD:refs/heads/main");
  git(root, "checkout", "--detach", baseSha);
  const previous = process.env.GITHUB_REF_NAME;
  process.env.GITHUB_REF_NAME = "main";
  try {
    assert.throws(
      () =>
        publish(root, folder, {
          github: () => {
            throw Error("Must not call GitHub before checking source drift");
          },
        }),
      /Source changed while/
    );
  } finally {
    if (previous === undefined) delete process.env.GITHUB_REF_NAME;
    else process.env.GITHUB_REF_NAME = previous;
  }
});
