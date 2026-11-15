import { build } from "esbuild";
import { mkdir } from "node:fs/promises";
import { spawnSync } from "node:child_process";
const outfile = ".tmp/source-website-search/checks.cjs";
await mkdir(".tmp/source-website-search", { recursive: true });
await build({
  entryPoints: ["scripts/fixtures/source-website-search.test.tsx"],
  outfile,
  bundle: true,
  platform: "node",
  format: "cjs",
  packages: "external",
  jsx: "automatic",
});
const result = spawnSync(process.execPath, ["--test", outfile], {
  stdio: "inherit",
  windowsHide: true,
});
process.exitCode = result.status ?? 1;
