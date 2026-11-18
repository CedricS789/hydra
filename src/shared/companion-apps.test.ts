import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  parseWindowsCommandLine,
  quoteWindowsArguments,
  validateCompanionApps,
} from "./companion-apps.js";

const entry = {
  id: "1",
  name: "Utility",
  executablePath: "C:\\Tools\\Utility.exe",
  arguments: "",
  workingDirectory: "",
  enabled: true,
};
describe("companion app configuration", () => {
  it("accepts Windows, UNC and Linux absolute paths, normalizes runAsAdmin and removes unrelated fields", () => {
    for (const executablePath of [
      entry.executablePath,
      "\\\\server\\share\\tool.exe",
      "/usr/bin/tool",
    ]) {
      assert.deepEqual(
        validateCompanionApps([
          { ...entry, executablePath, runAsAdmin: false, secret: "ignored" },
        ]),
        [{ ...entry, executablePath }]
      );
    }
    assert.deepEqual(validateCompanionApps([{ ...entry, runAsAdmin: true }]), [
      { ...entry, runAsAdmin: true },
    ]);
  });
  it("rejects invalid data, duplicate IDs, relative paths, invalid runAsAdmin and null bytes", () => {
    for (const invalid of [
      null,
      {},
      [null],
      [{ ...entry, id: "" }],
      [entry, entry],
      [{ ...entry, enabled: "true" }],
      [{ ...entry, runAsAdmin: "yes" }],
      [{ ...entry, executablePath: "tool.exe" }],
      [{ ...entry, workingDirectory: "relative" }],
      [{ ...entry, arguments: "bad\0value" }],
    ]) {
      assert.throws(
        () => validateCompanionApps(invalid),
        /companion_apps_invalid/
      );
    }
  });
});
describe("Windows process command-line parsing", () => {
  it("preserves paths, spaces, empty arguments and trailing slashes", () => {
    assert.deepEqual(
      parseWindowsCommandLine(
        '"C:\\Program Files\\Utility.exe" "C:\\My Scripts\\one.ahk" "" --flag'
      ),
      [
        "C:\\Program Files\\Utility.exe",
        "C:\\My Scripts\\one.ahk",
        "",
        "--flag",
      ]
    );
    assert.deepEqual(parseWindowsCommandLine("app.exe C:\\folder\\"), [
      "app.exe",
      "C:\\folder\\",
    ]);
    assert.deepEqual(parseWindowsCommandLine("  app.exe   "), ["app.exe"]);
  });
  it("handles escaped quotes and quoted trailing backslashes", () => {
    assert.deepEqual(
      parseWindowsCommandLine(
        String.raw`app.exe "say \"hello\"" "C:\folder\\"`
      ),
      ["app.exe", 'say "hello"', "C:\\folder\\"]
    );
  });
  it("quotes Windows arguments so spaces, empty values, quotes and trailing backslashes round-trip", () => {
    const args = [
      "C:\\Program Files\\Tool\\script.ahk",
      "",
      'say "hello"',
      "C:\\My Folder\\",
      'C:\\With\\Quote\\"End\\',
      "--plain",
    ];
    const encoded = quoteWindowsArguments(args);
    assert.deepEqual(parseWindowsCommandLine(encoded), args);
    assert.equal(quoteWindowsArguments([]), "");
  });
});
