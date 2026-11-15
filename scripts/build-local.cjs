const fs = require("node:fs"),
  path = require("node:path"),
  cp = require("node:child_process");
const root = path.resolve(__dirname, ".."),
  edition = require("../src/shared/local-edition.json");
const allowed = new Set([
  "PATH",
  "PATHEXT",
  "SYSTEMROOT",
  "WINDIR",
  "SYSTEMDRIVE",
  "COMSPEC",
  "USERPROFILE",
  "APPDATA",
  "LOCALAPPDATA",
  "TEMP",
  "TMP",
  "PROGRAMFILES",
  "PROGRAMFILES(X86)",
  "PROGRAMW6432",
  "NUMBER_OF_PROCESSORS",
  "PROCESSOR_ARCHITECTURE",
  "OS",
  "PUBLIC",
  "HOMEDRIVE",
  "HOMEPATH",
  "CARGO_HOME",
  "RUSTUP_HOME",
]);
const env = Object.fromEntries(
  Object.entries(process.env).filter(([k]) => allowed.has(k.toUpperCase()))
);
Object.assign(env, {
  ELECTRON_CACHE: path.join(root, ".tmp", "electron-cache"),
  ELECTRON_BUILDER_CACHE: path.join(root, ".tmp", "electron-builder-cache"),
  YARN_CACHE_FOLDER: path.join(root, ".tmp", "yarn-cache"),
  npm_config_cache: path.join(root, ".tmp", "npm-cache"),
  NODE_OPTIONS: "--max-old-space-size=6144",
  HUSKY: "0",
});
const run = (file, args) => {
  const result = cp.spawnSync(file, args, {
    cwd: root,
    env,
    stdio: "inherit",
    windowsHide: true,
  });
  if (result.error) throw result.error;
  if (result.status !== 0)
    throw Error(`${path.basename(file)} exited ${result.status}`);
};
function packageFromAsar(archive) {
  const fd = fs.openSync(archive, "r");
  try {
    const header = Buffer.alloc(16);
    fs.readSync(fd, header);
    const json = Buffer.alloc(header.readUInt32LE(12));
    fs.readSync(fd, json, 0, json.length, 16);
    const entry = JSON.parse(json.toString()).files["package.json"];
    const data = Buffer.alloc(entry.size);
    fs.readSync(
      fd,
      data,
      0,
      data.length,
      8 + header.readUInt32LE(4) + Number(entry.offset)
    );
    return JSON.parse(data.toString());
  } finally {
    fs.closeSync(fd);
  }
}
function reuseInstalled() {
  const candidates = [
    process.env.LOCALAPPDATA &&
      path.join(process.env.LOCALAPPDATA, "Programs", "Hydra", "resources"),
    process.env.PROGRAMFILES &&
      path.join(process.env.PROGRAMFILES, "Hydra", "resources"),
    process.env["PROGRAMFILES(X86)"] &&
      path.join(process.env["PROGRAMFILES(X86)"], "Hydra", "resources"),
  ].filter(Boolean);
  const installed = candidates.find((dir) =>
    fs.existsSync(path.join(dir, "app.asar"))
  );
  if (!installed)
    throw Error(
      "Official Hydra was not found in %LOCALAPPDATA%\\Programs\\Hydra or %ProgramFiles%\\Hydra. Use the full source build otherwise."
    );
  const pkg = packageFromAsar(path.join(installed, "app.asar"));
  if (`v${pkg.version}` !== edition.upstreamTag)
    throw Error(
      "Installed Hydra must match the exact upstream base. Use the full source build otherwise."
    );
  for (const name of ["hydra-native", "ludusavi"])
    fs.cpSync(path.join(installed, name), path.join(root, name), {
      recursive: true,
    });
  fs.cpSync(
    path.join(installed, "legendary"),
    path.join(root, "legendary", "win32", "x64"),
    { recursive: true }
  );
  const target = path.join(
    root,
    "node_modules",
    "classic-level",
    "build",
    "Release"
  );
  fs.mkdirSync(target, { recursive: true });
  fs.copyFileSync(
    path.join(
      installed,
      "app.asar.unpacked",
      "node_modules",
      "classic-level",
      "build",
      "Release",
      "classic_level.node"
    ),
    path.join(target, "classic_level.node")
  );
  process.stdout.write(
    `Reusing unchanged native resources from official Hydra ${pkg.version}.\n`
  );
}
async function prepareWindowsPackagingTools() {
  if (process.platform !== "win32") return;
  const dir = path.join(
    env.ELECTRON_BUILDER_CACHE,
    "winCodeSign",
    "winCodeSign-2.6.0"
  );
  if (fs.existsSync(path.join(dir, "rcedit-x64.exe"))) return;
  const archive = path.join(root, ".tmp", "downloads", "winCodeSign-2.6.0.7z");
  fs.mkdirSync(path.dirname(archive), { recursive: true });
  const response = await fetch(
    "https://github.com/electron-userland/electron-builder-binaries/releases/download/winCodeSign-2.6.0/winCodeSign-2.6.0.7z"
  );
  if (!response.ok)
    throw new Error("Could not download Windows packaging tools");
  const data = Buffer.from(await response.arrayBuffer());
  if (
    require("node:crypto").createHash("sha512").update(data).digest("hex") !==
    "e8b408d9df413c2dd7b346684d07b5a37b4f880dbc73bf8f63af50f62fe90fc958e39a6c32d1ee2f0bf7bd1724895af7671d5c6cdc8b94147c493c0275c1f0b4"
  )
    throw new Error("Windows packaging tools checksum mismatch");
  fs.writeFileSync(archive, data);
  // The archive also contains macOS symlinks, which Windows cannot create
  // without extra privileges. Only Windows tools are needed for this target.
  run(path.join(root, "node_modules", "7zip-bin", "win", "x64", "7za.exe"), [
    "x",
    "-y",
    "-xr!darwin",
    archive,
    `-o${dir}`,
  ]);
  fs.rmSync(archive);
}

function enableVisualStudio2026InNodeGyp() {
  const finderPath = path.join(
    root,
    "node_modules",
    "@electron",
    "node-gyp",
    "lib",
    "find-visualstudio.js"
  );
  if (!fs.existsSync(finderPath)) return;
  let source = fs.readFileSync(finderPath, "utf8");
  if (!source.includes("ret.versionMajor === 18")) {
    source = source
      .replaceAll("[2019, 2022]", "[2019, 2022, 2026]")
      .replace(
        /(if \(ret\.versionMajor === 17\) \{\r?\n\s+ret\.versionYear = 2022\r?\n\s+return ret\r?\n\s+\})/,
        "$1\n    if (ret.versionMajor === 18) {\n      ret.versionYear = 2026\n      return ret\n    }"
      )
      .replace(
        /(\} else if \(versionYear === 2022\) \{\r?\n\s+return 'v143')/,
        "$1\n    } else if (versionYear === 2026) {\n      return 'v145'"
      );
  }
  if (!source.includes("Win1[01]SDK_10")) {
    source = source.replace(
      "if (!pkg.startsWith(win10SDKPrefix) && !pkg.startsWith(win11SDKPrefix)) {",
      "const sdkMatch = /^Win1[01]SDK_10\\.0\\.(\\d+)$/.exec(pkg); if (sdkMatch) { Win10or11SDKVer = Math.max(Win10or11SDKVer, parseInt(sdkMatch[1], 10)); return; } if (!pkg.startsWith(win10SDKPrefix) && !pkg.startsWith(win11SDKPrefix)) {"
    );
  }
  fs.writeFileSync(finderPath, source);
}

function prepareClassicLevel() {
  enableVisualStudio2026InNodeGyp();
  try {
    run(process.execPath, [
      "node_modules/electron-builder/cli.js",
      "install-app-deps",
    ]);
    return;
  } catch (error) {
    const prebuild = path.join(
      root,
      "node_modules",
      "classic-level",
      "prebuilds",
      `${process.platform}-${process.arch}`,
      "classic-level.node"
    );
    if (!fs.existsSync(prebuild)) throw error;
    const target = path.join(
      root,
      "node_modules",
      "classic-level",
      "build",
      "Release",
      "classic_level.node"
    );
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.copyFileSync(prebuild, target);
    const check = cp.spawnSync(
      require("electron"),
      [
        "-e",
        "const mod = require(process.argv[1]); if (!mod || !mod.db_open) process.exit(1);",
        target,
      ],
      {
        cwd: root,
        env: { ...env, ELECTRON_RUN_AS_NODE: "1" },
        windowsHide: true,
      }
    );
    if (check.error || check.status !== 0) throw error;
    process.stdout.write(
      "Using verified prebuilt N-API classic_level.node binary.\n"
    );
  }
}

async function main() {
  await prepareWindowsPackagingTools();
  try {
    if (process.argv.includes("--reuse-installed-native")) reuseInstalled();
    else {
      run(process.execPath, ["scripts/build-native-addon.cjs"]);
      prepareClassicLevel();
    }
    run(process.execPath, ["scripts/postinstall.cjs"]);
    run(process.execPath, ["scripts/prepare-legendary.cjs"]);
    env.MAIN_VITE_SOURCE_REF = cp
      .execFileSync("git", ["rev-parse", "HEAD"], {
        cwd: root,
        env,
        encoding: "utf8",
        windowsHide: true,
      })
      .trim();
    run(process.execPath, [
      "node_modules/typescript/bin/tsc",
      "--noEmit",
      "-p",
      "tsconfig.node.json",
      "--composite",
      "false",
    ]);
    run(process.execPath, [
      "node_modules/typescript/bin/tsc",
      "--noEmit",
      "-p",
      "tsconfig.web.json",
      "--composite",
      "false",
    ]);
    run(process.execPath, [
      "node_modules/electron-vite/bin/electron-vite.js",
      "build",
    ]);
    run(process.execPath, [
      "node_modules/electron-builder/cli.js",
      "--win",
      "nsis",
      "--x64",
      "--publish",
      "never",
    ]);
    run(process.execPath, ["scripts/verify-local-package.cjs"]);
    const pkg = require("../package.json");
    const installer = `hydra-ludusavi-${pkg.version}-setup.exe`;
    fs.mkdirSync(path.join(root, "dist"), { recursive: true });
    for (const file of [installer, `${installer}.blockmap`, "latest.yml"]) {
      fs.copyFileSync(
        path.join(root, ".tmp", "package", file),
        path.join(root, "dist", file)
      );
    }
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}
main().catch((error) => {
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 1;
});
