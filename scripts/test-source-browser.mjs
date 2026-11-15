import { build as bundle } from "esbuild";
import { build as buildRenderer } from "vite";
import { mkdir, writeFile, copyFile } from "node:fs/promises";
import path from "node:path";
import { createRequire } from "node:module";
import { spawn } from "node:child_process";
import net from "node:net";
const require = createRequire(import.meta.url);
const root = process.cwd();
const output = path.join(root, ".tmp/source-browser-check");
await mkdir(path.join(output, "main"), { recursive: true });
await mkdir(path.join(output, "preload"), { recursive: true });
await copyFile(
  "src/preload/source-browser.cjs",
  path.join(output, "preload/source-browser.cjs")
);
await bundle({
  entryPoints: ["src/shared/source-browser-policy.test.ts"],
  outfile: path.join(output, "policy.test.cjs"),
  bundle: true,
  platform: "node",
  format: "cjs",
});
const run = (exe, args, env = process.env) =>
  new Promise((resolve, reject) => {
    const child = spawn(exe, args, {
      cwd: root,
      env,
      stdio: "inherit",
      windowsHide: true,
    });
    child.on("error", reject);
    child.on("exit", (code) =>
      code === 0
        ? resolve()
        : reject(new Error(`Source browser checks exited ${code}`))
    );
  });
await run(process.execPath, ["--test", path.join(output, "policy.test.cjs")]);
await buildRenderer({
  configFile: false,
  root: path.join(root, "src/renderer"),
  base: "./",
  logLevel: "warn",
  build: {
    outDir: path.join(output, "renderer"),
    emptyOutDir: true,
    rollupOptions: {
      input: path.join(root, "src/renderer/source-browser.html"),
    },
  },
});
const shim = path.join(output, "electron-shim.cjs");
await writeFile(
  shim,
  `const electron = require('electron'); module.exports = {...electron, BrowserWindow: function(options) { return new electron.BrowserWindow({...options, show:false, webPreferences:{...options.webPreferences,backgroundThrottling:false}}); }, WebContentsView: function(options) {return new electron.WebContentsView({...options,webPreferences:{...options.webPreferences,backgroundThrottling:false}});}};`
);
await bundle({
  entryPoints: ["src/main/services/source-browser.ts"],
  outfile: path.join(output, "main/service.cjs"),
  bundle: true,
  platform: "node",
  format: "cjs",
  plugins: [
    {
      name: "isolated-test-dependencies",
      setup(build) {
        build.onResolve({ filter: /^electron$/ }, (args) =>
          args.importer === shim
            ? { path: "electron", external: true }
            : { path: shim }
        );
        build.onResolve({ filter: /^@main\/level$/ }, () => ({
          path: "database",
          namespace: "test",
        }));
        build.onResolve({ filter: /^\.\/window-manager$/ }, () => ({
          path: "windows",
          namespace: "test",
        }));
        build.onResolve(
          { filter: /^\.\/download\/multipart-hoster-feature$/ },
          () => ({ path: "multipart", namespace: "test" })
        );
        build.onLoad({ filter: /.*/, namespace: "test" }, ({ path: key }) => ({
          contents:
            key === "database"
              ? `export const db=globalThis.sourceBrowserTestDb; export const levelKeys={userPreferences:'userPreferences'};`
              : key === "windows"
                ? `export const WindowManager=globalThis.sourceBrowserTestWindows;`
                : `export async function assertMultipartHosterDownloadsEnabled(){if(!globalThis.sourceBrowserTestParts) throw new Error('Multi-part hoster downloads are turned off.');}`,
        }));
      },
    },
  ],
});
const runner = path.join(output, "smoke.cjs");
await copyFile("scripts/fixtures/source-browser-smoke.cjs", runner);
await copyFile(
  "scripts/fixtures/source-browser-tls.cjs",
  path.join(output, "source-browser-tls.cjs")
);
const env = { ...process.env };
env.SOURCE_BROWSER_FIXTURE_PORT = String(
  await new Promise((resolve, reject) => {
    const reservation = net.createServer();
    reservation.once("error", reject);
    reservation.listen(0, "127.0.0.1", () => {
      const port = reservation.address().port;
      reservation.close(() => resolve(port));
    });
  })
);
delete env.ELECTRON_RUN_AS_NODE;
delete env.ELECTRON_RENDERER_URL;
await run(require("electron"), [runner], env);
