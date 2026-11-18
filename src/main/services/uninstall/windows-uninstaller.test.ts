import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import {
  findInFolderUninstaller,
  matchRegistryUninstallerEntries,
  parseRegQueryOutput,
  parseUninstallCommand,
} from "./windows-uninstaller.js";

describe("windows-uninstaller", () => {
  it("detects unambiguous in-folder uninstallers and ignores setup.exe", async (t) => {
    const tempRoot = await fs.promises.mkdtemp(
      path.join(os.tmpdir(), "hydra-infolder-unins-")
    );
    t.after(() => fs.promises.rm(tempRoot, { recursive: true, force: true }));

    const gameRoot = path.join(tempRoot, "MyGame");
    await fs.promises.mkdir(gameRoot, { recursive: true });
    await fs.promises.writeFile(path.join(gameRoot, "setup.exe"), "setup");
    assert.equal(await findInFolderUninstaller(gameRoot), null);

    const uninsPath = path.join(gameRoot, "unins000.exe");
    await fs.promises.writeFile(uninsPath, "unins");
    const found = await findInFolderUninstaller(gameRoot);
    assert.deepEqual(found, {
      kind: "in-folder",
      label: "unins000.exe",
      executablePath: uninsPath,
      args: [],
      requiresElevationHint: true,
    });
  });

  it("parses quoted, unquoted, and MSI UninstallString safely while rejecting shell injection", async () => {
    const gameRoot = String.raw`D:\Games\Cool Game`;

    const quoted = await parseUninstallCommand(
      String.raw`"D:\Games\Cool Game\unins000.exe" /SILENT`,
      gameRoot,
      {
        displayName: "Cool Game",
        fileExists: async (p) =>
          p.toLowerCase() === String.raw`d:\games\cool game\unins000.exe`,
      }
    );
    assert.deepEqual(quoted, {
      kind: "registry-exe",
      label: "Cool Game",
      executablePath: String.raw`D:\Games\Cool Game\unins000.exe`,
      args: ["/SILENT"],
      requiresElevationHint: true,
    });

    const unquoted = await parseUninstallCommand(
      String.raw`D:\Games\Cool Game\uninstall.exe /S`,
      gameRoot,
      {
        fileExists: async (p) =>
          p.toLowerCase() === String.raw`d:\games\cool game\uninstall.exe`,
      }
    );
    assert.equal(unquoted?.executablePath, String.raw`D:\Games\Cool Game\uninstall.exe`);
    assert.deepEqual(unquoted?.args, ["/S"]);

    const msi = await parseUninstallCommand(
      "MsiExec.exe /I{12345678-1234-1234-1234-1234567890AB}",
      gameRoot,
      { winDir: String.raw`C:\Windows` }
    );
    assert.deepEqual(msi, {
      kind: "registry-msi",
      label: "Windows Installer",
      executablePath: String.raw`C:\Windows\System32\msiexec.exe`,
      args: ["/x", "{12345678-1234-1234-1234-1234567890AB}"],
      requiresElevationHint: true,
    });

    assert.equal(
      await parseUninstallCommand(
        String.raw`"D:\Games\Cool Game\unins000.exe" & calc.exe`,
        gameRoot,
        { fileExists: async () => true }
      ),
      null
    );

    assert.equal(
      await parseUninstallCommand("steam://uninstall/123", gameRoot, {
        fileExists: async () => true,
      }),
      null
    );

    assert.equal(
      await parseUninstallCommand(
        String.raw`"D:\OtherApp\uninstall.exe"`,
        gameRoot,
        { fileExists: async () => true }
      ),
      null
    );
  });

  it("parses reg.exe query output and matches only entries owning gameRoot", async () => {
    const sample = [
      String.raw`HKLM\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\OtherApp`,
      String.raw`    DisplayName    REG_SZ    Other App`,
      String.raw`    InstallLocation    REG_SZ    D:\Games\Other App`,
      String.raw`    UninstallString    REG_SZ    "D:\Games\Other App\uninstall.exe"`,
      "",
      String.raw`HKLM\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\{12345678-1234-1234-1234-1234567890AB}`,
      String.raw`    DisplayName    REG_SZ    Target Game`,
      String.raw`    InstallLocation    REG_SZ    D:\Games\Target Game`,
      String.raw`    UninstallString    REG_SZ    MsiExec.exe /I{12345678-1234-1234-1234-1234567890AB}`,
    ].join("\r\n");

    const parsed = parseRegQueryOutput(sample);
    assert.equal(parsed.length, 2);

    const matched = await matchRegistryUninstallerEntries(
      parsed,
      String.raw`D:\Games\Target Game`,
      {
        winDir: String.raw`C:\Windows`,
        fileExists: async () => true,
      }
    );
    assert.deepEqual(matched, {
      kind: "registry-msi",
      label: "Target Game",
      executablePath: String.raw`C:\Windows\System32\msiexec.exe`,
      args: ["/x", "{12345678-1234-1234-1234-1234567890AB}"],
      requiresElevationHint: true,
    });
  });
});
