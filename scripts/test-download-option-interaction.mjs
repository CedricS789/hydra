import { build } from "vite";
import react from "@vitejs/plugin-react";
import { mkdir, writeFile, copyFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { spawn } from "node:child_process";
import path from "node:path";
const root = process.cwd(),
  output = path.join(root, ".tmp/download-option-interaction");
await mkdir(output, { recursive: true });
await copyFile(
  "scripts/fixtures/download-option-interaction.tsx",
  path.join(output, "fixture.tsx")
);
await copyFile(
  "scripts/fixtures/download-option-interaction-smoke.cjs",
  path.join(output, "smoke.cjs")
);
await writeFile(
  path.join(output, "index.html"),
  '<!doctype html><html><body><div id="root"></div><script type="module" src="./fixture.tsx"></script></body></html>'
);
await build({
  configFile: false,
  root: output,
  base: "./",
  logLevel: "warn",
  plugins: [react()],
  resolve: { alias: { "@renderer": path.join(root, "src/renderer/src") } },
  build: { outDir: path.join(output, "renderer"), emptyOutDir: true },
});
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
await new Promise((resolve, reject) => {
  const child = spawn(
    createRequire(import.meta.url)("electron"),
    [path.join(output, "smoke.cjs")],
    { cwd: root, env, windowsHide: true, stdio: "inherit" }
  );
  child.on("error", reject);
  child.on("exit", (code) =>
    code === 0 ? resolve() : reject(Error(`Picker UI checks exited ${code}`))
  );
});
