const axios = require("axios"),
  fs = require("node:fs"),
  path = require("node:path");
const { extract } = require("@electron-internal/extract-zip");
const { pipeline } = require("node:stream/promises");
const version = "0.29.0";
(async () => {
  const platform = process.platform;
  const binary = platform === "win32" ? "ludusavi.exe" : "ludusavi";
  const target = path.join(process.cwd(), "ludusavi");
  if (fs.existsSync(path.join(target, binary))) return;
  const archive =
    platform === "win32"
      ? `ludusavi-v${version}-win64.zip`
      : platform === "darwin"
        ? `ludusavi-v${version}-mac.tar.gz`
        : `ludusavi-v${version}-linux.tar.gz`;
  const scratch = path.join(process.cwd(), ".tmp", "downloads");
  fs.mkdirSync(scratch, { recursive: true });
  fs.mkdirSync(target, { recursive: true });
  const file = path.join(scratch, archive);
  try {
    const response = await axios.get(
      `https://github.com/mtkennerly/ludusavi/releases/download/v${version}/${archive}`,
      { responseType: "stream", timeout: 120000 }
    );
    await pipeline(response.data, fs.createWriteStream(file));
    if (platform === "win32") await extract(file, { dir: target });
    else {
      await require("tar").x({ file, cwd: target });
      fs.chmodSync(path.join(target, binary), 0o755);
    }
    process.stdout.write(`Prepared Ludusavi ${version}.\n`);
  } finally {
    fs.rmSync(file, { force: true });
  }
})().catch((error) => {
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 1;
});
