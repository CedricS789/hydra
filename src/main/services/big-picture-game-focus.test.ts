import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  normalizeFocusExecutablePath,
  resolveGameCandidatePids,
  selectPreferredGameWindow,
  shouldAttemptWindowFocus,
} from "./big-picture-game-focus-policy.js";

describe("Big Picture game window focus policy", () => {
  it("normalizes Windows executable paths case-insensitively", () => {
    assert.equal(
      normalizeFocusExecutablePath("C:/Games/Test/Game.EXE", "win32"),
      "c:\\games\\test\\game.exe"
    );
  });

  it("collects descendant PIDs from both root PIDs and matched executables", () => {
    const pids = resolveGameCandidatePids({
      rootPids: [100],
      executablePaths: ["C:/Steam/steamapps/common/MyGame/Game.exe"],
      platform: "win32",
      processTree: [
        { pid: 100, parentPid: 1, exe: "C:\\Launcher\\bootstrap.exe" },
        { pid: 101, parentPid: 100, exe: "C:\\Launcher\\splash.exe" },
        { pid: 102, parentPid: 101, exe: "C:\\Game\\shipping.exe" },
        {
          pid: 200,
          parentPid: 50,
          exe: "C:\\Steam\\steamapps\\common\\MyGame\\Game.exe",
        },
        { pid: 201, parentPid: 200, exe: "C:\\Steam\\crashpad.exe" },
        { pid: 999, parentPid: 1, exe: "C:\\Other\\unrelated.exe" },
      ],
    });

    assert.deepEqual(
      pids.sort((a, b) => a - b),
      [100, 101, 102, 200, 201]
    );
  });

  it("prefers non-minimized, non-tool, largest windows not yet focused", () => {
    const selected = selectPreferredGameWindow(
      [
        {
          windowHandle: "10",
          processId: 100,
          area: 2_000_000,
          isMinimized: true,
          isToolWindow: false,
        },
        {
          windowHandle: "11",
          processId: 100,
          area: 300_000,
          isMinimized: false,
          isToolWindow: true,
        },
        {
          windowHandle: "12",
          processId: 100,
          area: 100_000,
          isMinimized: false,
          isToolWindow: false,
        },
        {
          windowHandle: "13",
          processId: 101,
          area: 2_073_600,
          isMinimized: false,
          isToolWindow: false,
        },
      ],
      new Set(["13"])
    );

    assert.equal(selected?.windowHandle, "12");
  });

  it("only overrides foreground after initial focus if Hydra still owns foreground", () => {
    const target = {
      windowHandle: "99",
      processId: 200,
      area: 1920 * 1080,
      isMinimized: false,
      isToolWindow: false,
    };

    assert.equal(
      shouldAttemptWindowFocus({
        target,
        hasFocusedAnyWindow: false,
        foregroundHandle: "500",
        bigPictureHandle: "1",
        gameLauncherHandle: "2",
      }),
      true
    );

    // User switched to a third-party window after game was already focused.
    assert.equal(
      shouldAttemptWindowFocus({
        target,
        hasFocusedAnyWindow: true,
        foregroundHandle: "500",
        bigPictureHandle: "1",
        gameLauncherHandle: "2",
      }),
      false
    );

    // Splash exited and focus bounced back to Big Picture or launch popup.
    assert.equal(
      shouldAttemptWindowFocus({
        target,
        hasFocusedAnyWindow: true,
        foregroundHandle: "1",
        bigPictureHandle: "1",
        gameLauncherHandle: "2",
      }),
      true
    );
    assert.equal(
      shouldAttemptWindowFocus({
        target,
        hasFocusedAnyWindow: true,
        foregroundHandle: "2",
        bigPictureHandle: "1",
        gameLauncherHandle: "2",
      }),
      true
    );
  });
});
