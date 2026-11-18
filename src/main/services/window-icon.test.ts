import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

import { resolveWindowIconOption } from "./window-icon.js";

interface IcoEntry {
  width: number;
  height: number;
  bytesInRes: number;
}

const parseIcoEntries = (buffer: Buffer): IcoEntry[] => {
  const reserved = buffer.readUInt16LE(0);
  const type = buffer.readUInt16LE(2);
  const count = buffer.readUInt16LE(4);
  assert.equal(reserved, 0);
  assert.equal(type, 1);

  const entries: IcoEntry[] = [];
  for (let i = 0; i < count; i += 1) {
    const offset = 6 + i * 16;
    const rawWidth = buffer.readUInt8(offset);
    const rawHeight = buffer.readUInt8(offset + 1);
    const bytesInRes = buffer.readUInt32LE(offset + 8);
    entries.push({
      width: rawWidth === 0 ? 256 : rawWidth,
      height: rawHeight === 0 ? 256 : rawHeight,
      bytesInRes,
    });
  }
  return entries;
};

describe("resolveWindowIconOption", () => {
  const pngIcon = "/app/resources/icon.png";
  const winIcoIcon = "C:\\app\\resources\\icon.ico";

  it("omits the BrowserWindow icon on packaged Windows builds", () => {
    assert.equal(
      resolveWindowIconOption({
        platform: "win32",
        isPackaged: true,
        pngIcon,
        winIcoIcon,
      }),
      undefined
    );
  });

  it("uses the .ico asset on unpackaged Windows dev runs", () => {
    assert.equal(
      resolveWindowIconOption({
        platform: "win32",
        isPackaged: false,
        pngIcon,
        winIcoIcon,
      }),
      winIcoIcon
    );
  });

  it("keeps the PNG asset on Linux and macOS", () => {
    for (const platform of ["linux", "darwin"] as const) {
      for (const isPackaged of [false, true]) {
        assert.equal(
          resolveWindowIconOption({
            platform,
            isPackaged,
            pngIcon,
            winIcoIcon,
          }),
          pngIcon
        );
      }
    }
  });
});

describe("Windows ICO assets", () => {
  const root = process.cwd();
  const buildIcoPath = path.join(root, "build", "icon.ico");
  const resourcesIcoPath = path.join(root, "resources", "icon.ico");

  it("keeps build/icon.ico and resources/icon.ico identical with Windows 11 sizes under 64 KB per frame", () => {
    const buildBuf = fs.readFileSync(buildIcoPath);
    const resourcesBuf = fs.readFileSync(resourcesIcoPath);
    assert.ok(buildBuf.equals(resourcesBuf));

    const entries = parseIcoEntries(buildBuf);
    const widths = new Set(entries.map((entry) => entry.width));
    for (const expectedSize of [16, 20, 24, 32, 40, 48, 64, 128, 256]) {
      assert.ok(
        widths.has(expectedSize),
        `Expected ${expectedSize}x${expectedSize} frame in icon.ico`
      );
    }

    for (const entry of entries) {
      assert.equal(entry.width, entry.height);
      assert.ok(
        entry.bytesInRes > 0 && entry.bytesInRes <= 65535,
        `Frame ${entry.width}x${entry.height} size ${entry.bytesInRes} must fit in 16 bits for rcedit`
      );
    }
  });
});
