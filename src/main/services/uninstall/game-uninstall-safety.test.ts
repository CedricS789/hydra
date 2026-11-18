import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import type { Game } from "@types";
import {
  isUnsafeUninstallPath,
  resolveIsolatedWinePrefixForUninstall,
  validateUninstallDirectory,
} from "./game-uninstall-safety.js";

const makeGame = (overrides: Partial<Game> = {}): Game =>
  ({
    title: "Test Game",
    iconUrl: null,
    libraryHeroImageUrl: null,
    logoImageUrl: null,
    playTimeInMilliseconds: 0,
    lastTimePlayed: null,
    objectId: "100",
    shop: "steam",
    remoteId: null,
    isDeleted: false,
    ...overrides,
  }) as Game;

describe("game-uninstall-safety", () => {
  it("blocks protected roots, ancestors of protected roots, and shallow generic folders", () => {
    const context = {
      platform: "win32" as NodeJS.Platform,
      protectedRoots: [
        String.raw`C:\Users\cedric`,
        String.raw`C:\Users\cedric\Desktop`,
        String.raw`C:\Users\cedric\Downloads`,
        String.raw`D:\HydraDownloads`,
        String.raw`D:\SteamLibrary`,
        String.raw`D:\SteamLibrary\steamapps\common`,
      ],
    };

    assert.equal(isUnsafeUninstallPath("C:\\", context), true);
    assert.equal(isUnsafeUninstallPath(String.raw`C:\Users\cedric`, context), true);
    assert.equal(
      isUnsafeUninstallPath(String.raw`C:\Users\cedric\Desktop`, context),
      true
    );
    assert.equal(
      isUnsafeUninstallPath(String.raw`C:\Users\cedric\Games`, context),
      true
    );
    assert.equal(
      isUnsafeUninstallPath(String.raw`D:\SteamLibrary`, context),
      true
    );
    assert.equal(
      isUnsafeUninstallPath(String.raw`D:\HydraDownloads`, context),
      true
    );
    assert.equal(isUnsafeUninstallPath(String.raw`D:\Games`, context), true);
    assert.equal(
      isUnsafeUninstallPath(String.raw`D:\Games\Cyberpunk 2077`, context),
      false
    );
  });

  it("blocks Linux system directories and home directory", () => {
    const context = {
      platform: "linux" as NodeJS.Platform,
      protectedRoots: ["/home/cedric", "/home/cedric/Downloads"],
    };

    assert.equal(isUnsafeUninstallPath("/", context), true);
    assert.equal(isUnsafeUninstallPath("/usr/bin", context), true);
    assert.equal(isUnsafeUninstallPath("/home/cedric", context), true);
    assert.equal(isUnsafeUninstallPath("/home/cedric/Games", context), true);
    assert.equal(
      isUnsafeUninstallPath("/home/cedric/Games/Hades", context),
      false
    );
  });

  it("rejects directories shared with another non-deleted library game", async (t) => {
    const tempRoot = await fs.promises.mkdtemp(
      path.join(os.tmpdir(), "hydra-uninstall-safety-")
    );
    t.after(() => fs.promises.rm(tempRoot, { recursive: true, force: true }));

    const gameDir = path.join(tempRoot, "GamesCollection", "MyGame");
    const exeA = path.join(gameDir, "gameA.exe");
    const exeB = path.join(gameDir, "sub", "gameB.exe");
    await fs.promises.mkdir(path.dirname(exeB), { recursive: true });
    await fs.promises.writeFile(exeA, "a");
    await fs.promises.writeFile(exeB, "b");

    const gameA = makeGame({
      objectId: "1",
      title: "Game A",
      executablePath: exeA,
    });
    const gameB = makeGame({
      objectId: "2",
      title: "Game B",
      executablePath: exeB,
    });

    const result = await validateUninstallDirectory(
      gameDir,
      gameA,
      [gameA, gameB],
      { protectedRoots: [tempRoot] }
    );

    assert.equal(result.valid, false);
    assert.equal(result.block?.reason, "shared-with-other-game");
    assert.equal(result.block?.details, "Game B");
  });

  it("rejects LaunchBox games and symlinks", async (t) => {
    const tempRoot = await fs.promises.mkdtemp(
      path.join(os.tmpdir(), "hydra-uninstall-symlink-")
    );
    t.after(() => fs.promises.rm(tempRoot, { recursive: true, force: true }));

    const realDir = path.join(tempRoot, "RealGame");
    await fs.promises.mkdir(realDir, { recursive: true });
    const exePath = path.join(realDir, "game.exe");
    await fs.promises.writeFile(exePath, "exe");

    const launchboxGame = makeGame({
      shop: "launchbox",
      objectId: "lb-1",
      executablePath: exePath,
    });

    const launchboxResult = await validateUninstallDirectory(
      realDir,
      launchboxGame,
      [launchboxGame],
      { protectedRoots: [tempRoot] }
    );
    assert.equal(launchboxResult.valid, false);
    assert.equal(launchboxResult.block?.reason, "unsafe-path");

    const symlinkDir = path.join(tempRoot, "LinkedGame");
    try {
      await fs.promises.symlink(realDir, symlinkDir, "junction");
    } catch {
      return;
    }

    const linkedGame = makeGame({
      objectId: "10",
      executablePath: path.join(symlinkDir, "game.exe"),
    });
    const symlinkResult = await validateUninstallDirectory(
      symlinkDir,
      linkedGame,
      [linkedGame],
      { protectedRoots: [tempRoot] }
    );
    assert.equal(symlinkResult.valid, false);
    assert.equal(symlinkResult.block?.reason, "symlink-target");
  });

  it("accepts a dedicated non-shared game directory", async (t) => {
    const tempRoot = await fs.promises.mkdtemp(
      path.join(os.tmpdir(), "hydra-uninstall-valid-")
    );
    t.after(() => fs.promises.rm(tempRoot, { recursive: true, force: true }));

    const gameDir = path.join(tempRoot, "DedicatedGame");
    const exePath = path.join(gameDir, "bin", "game.exe");
    await fs.promises.mkdir(path.dirname(exePath), { recursive: true });
    await fs.promises.writeFile(exePath, "exe");

    const targetGame = makeGame({ executablePath: exePath });
    const deletedGame = makeGame({
      objectId: "999",
      isDeleted: true,
      executablePath: path.join(gameDir, "old.exe"),
    });

    const result = await validateUninstallDirectory(
      gameDir,
      targetGame,
      [targetGame, deletedGame],
      { protectedRoots: [tempRoot] }
    );

    assert.equal(result.valid, true);
    assert.equal(result.block, null);
  });

  it("only returns an isolated Wine prefix when not shared or default", async (t) => {
    const tempRoot = await fs.promises.mkdtemp(
      path.join(os.tmpdir(), "hydra-wine-prefix-")
    );
    t.after(() => fs.promises.rm(tempRoot, { recursive: true, force: true }));

    const homeDir = path.join(tempRoot, "home");
    const prefix1 = path.join(tempRoot, "prefixes", "100");
    const legacyPrefix = path.join(tempRoot, "legacy-prefix");
    await fs.promises.mkdir(prefix1, { recursive: true });
    await fs.promises.mkdir(legacyPrefix, { recursive: true });

    const game1 = makeGame({ objectId: "100", winePrefixPath: prefix1 });
    const game2Shared = makeGame({ objectId: "200", winePrefixPath: prefix1 });
    const game2Separate = makeGame({
      objectId: "200",
      winePrefixPath: path.join(tempRoot, "prefixes", "200"),
    });

    const sharedResult = await resolveIsolatedWinePrefixForUninstall({
      targetGame: game1,
      effectivePrefixPath: prefix1,
      legacyDefaultPrefixPath: legacyPrefix,
      homeDir,
      allGames: [game1, game2Shared],
      resolveEffectivePrefixForGame: (g) => g.winePrefixPath ?? null,
      validatePrefix: () => true,
      context: { platform: "linux", protectedRoots: [homeDir, tempRoot] },
    });
    assert.equal(sharedResult, null);

    const legacyResult = await resolveIsolatedWinePrefixForUninstall({
      targetGame: game1,
      effectivePrefixPath: legacyPrefix,
      legacyDefaultPrefixPath: legacyPrefix,
      homeDir,
      allGames: [game1],
      resolveEffectivePrefixForGame: (g) => g.winePrefixPath ?? null,
      validatePrefix: () => true,
      context: { platform: "linux", protectedRoots: [homeDir, tempRoot] },
    });
    assert.equal(legacyResult, null);

    const isolatedResult = await resolveIsolatedWinePrefixForUninstall({
      targetGame: game1,
      effectivePrefixPath: prefix1,
      legacyDefaultPrefixPath: legacyPrefix,
      homeDir,
      allGames: [game1, game2Separate],
      resolveEffectivePrefixForGame: (g) => g.winePrefixPath ?? null,
      validatePrefix: () => true,
      context: { platform: "linux", protectedRoots: [homeDir, tempRoot] },
    });
    assert.equal(
      isolatedResult,
      await fs.promises.realpath(prefix1)
    );
  });
});
