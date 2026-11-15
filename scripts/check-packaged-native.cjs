// Verify native ABI/loading in the matching Electron runtime, without starting
// the launcher, opening a real database, or signing into any account.
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const root = path.resolve(__dirname, "..");
const script = path.join(root, ".tmp", "native-load-check.cjs");
fs.mkdirSync(path.dirname(script), { recursive: true });
fs.writeFileSync(
  script,
  `
const path=require('node:path');
const resources=process.argv[2];
for(const file of ['hydra-native/hydra-native.node','app.asar.unpacked/node_modules/classic-level/build/Release/classic_level.node']) {
 const loaded=require(path.join(resources,file));
 if(!loaded || !Object.getOwnPropertyNames(loaded).length) throw Error('Native module has no exports: '+file);
}
console.log('Packaged native modules load in the matching Electron runtime.');
`
);
const result = spawnSync(
  require("electron"),
  [
    script,
    process.argv[2] ||
      path.join(root, ".tmp", "package", "win-unpacked", "resources"),
  ],
  {
    env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" },
    windowsHide: true,
    encoding: "utf8",
    timeout: 60_000,
  }
);
if (result.error) throw result.error;
process.stdout.write(result.stdout || "");
process.stderr.write(result.stderr || "");
if (result.status !== 0) process.exitCode = result.status || 1;
