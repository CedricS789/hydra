const fs = require("node:fs");
const path = require("node:path");
const root = path.resolve(__dirname, "..");
const resources = path.join(
  root,
  ".tmp",
  "package",
  "win-unpacked",
  "resources"
);
const archive = path.join(resources, "app.asar");
const fd = fs.openSync(archive, "r");
try {
  const header = Buffer.alloc(16);
  fs.readSync(fd, header);
  const raw = Buffer.alloc(header.readUInt32LE(12));
  fs.readSync(fd, raw, 0, raw.length, 16);
  const tree = JSON.parse(raw.toString("utf8"));
  const forbidden = Object.keys(tree.files).filter(
    (name) =>
      name === ".tmp" ||
      name === ".env" ||
      name.startsWith(".env.") ||
      name.endsWith(".tsbuildinfo")
  );
  if (forbidden.length)
    throw new Error(
      "Packaging included local scratch or configuration files; do not distribute this build."
    );
  const entry = tree.files["package.json"];
  const data = Buffer.alloc(entry.size);
  fs.readSync(
    fd,
    data,
    0,
    data.length,
    8 + header.readUInt32LE(4) + Number(entry.offset)
  );
  const packed = JSON.parse(data.toString("utf8"));
  const source = require("../package.json");
  if (packed.name !== source.name || packed.version !== source.version)
    throw new Error("Packaged application identity does not match the source.");
  for (const file of [
    "ludusavi/ludusavi.exe",
    "hydra-native/hydra-native.node",
    "app.asar.unpacked/node_modules/classic-level/build/Release/classic_level.node",
  ]) {
    if (!fs.existsSync(path.join(resources, file)))
      throw new Error(`Missing packaged runtime component: ${file}`);
  }
  process.stdout.write(
    "Package verified: expected identity and native resources; no scratch files or local environment configuration.\n"
  );
} finally {
  fs.closeSync(fd);
}
