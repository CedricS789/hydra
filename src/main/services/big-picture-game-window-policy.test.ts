import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { resolveBigPictureGameWindowTransition } from "./big-picture-game-window-policy.js";

describe("Big Picture game window policy", () => {
  it("does nothing when Big Picture is closed or mode is keep-open", () => {
    assert.equal(
      resolveBigPictureGameWindowTransition({
        mode: "minimize",
        bigPictureOpen: false,
        gamesRunning: true,
        suspendedBy: null,
        gamesRunningChangedToTrue: true,
      }),
      "none"
    );

    assert.equal(
      resolveBigPictureGameWindowTransition({
        mode: "keep-open",
        bigPictureOpen: true,
        gamesRunning: true,
        suspendedBy: null,
        gamesRunningChangedToTrue: true,
      }),
      "none"
    );
  });

  it("suspends when transitioning to running and restores when all games stop", () => {
    assert.equal(
      resolveBigPictureGameWindowTransition({
        mode: "minimize",
        bigPictureOpen: true,
        gamesRunning: true,
        suspendedBy: null,
        gamesRunningChangedToTrue: true,
      }),
      "minimize"
    );

    assert.equal(
      resolveBigPictureGameWindowTransition({
        mode: "hide",
        bigPictureOpen: true,
        gamesRunning: true,
        suspendedBy: null,
        gamesRunningChangedToTrue: true,
      }),
      "hide"
    );

    // Overlapping game starts while already suspended should not re-trigger.
    assert.equal(
      resolveBigPictureGameWindowTransition({
        mode: "hide",
        bigPictureOpen: true,
        gamesRunning: true,
        suspendedBy: "hide",
        gamesRunningChangedToTrue: false,
      }),
      "none"
    );

    assert.equal(
      resolveBigPictureGameWindowTransition({
        mode: "hide",
        bigPictureOpen: true,
        gamesRunning: false,
        suspendedBy: "hide",
        gamesRunningChangedToTrue: false,
      }),
      "restore"
    );
  });

  it("does not re-suspend after manual focus/reopen mid-game", () => {
    assert.equal(
      resolveBigPictureGameWindowTransition({
        mode: "minimize",
        bigPictureOpen: true,
        gamesRunning: true,
        suspendedBy: null,
        gamesRunningChangedToTrue: false,
      }),
      "none"
    );

    // On exit after manual focus, suspendedBy is null so restore does not fire.
    assert.equal(
      resolveBigPictureGameWindowTransition({
        mode: "minimize",
        bigPictureOpen: true,
        gamesRunning: false,
        suspendedBy: null,
        gamesRunningChangedToTrue: false,
      }),
      "none"
    );
  });

  it("restores if mode switches back to keep-open while suspended", () => {
    assert.equal(
      resolveBigPictureGameWindowTransition({
        mode: "keep-open",
        bigPictureOpen: true,
        gamesRunning: true,
        suspendedBy: "minimize",
        gamesRunningChangedToTrue: false,
      }),
      "restore"
    );

    assert.equal(
      resolveBigPictureGameWindowTransition({
        mode: "hide",
        bigPictureOpen: true,
        gamesRunning: true,
        suspendedBy: "minimize",
        gamesRunningChangedToTrue: false,
      }),
      "hide"
    );
  });

  it("suspends immediately at launch dispatch and restores if launch aborts", () => {
    assert.equal(
      resolveBigPictureGameWindowTransition({
        mode: "minimize",
        bigPictureOpen: true,
        gamesRunning: false,
        launchingGames: true,
        suspendedBy: null,
        gamesRunningChangedToTrue: false,
        launchTransitionedToActive: true,
      }),
      "minimize"
    );

    // Process detection arriving after pre-launch suspension does not re-trigger.
    assert.equal(
      resolveBigPictureGameWindowTransition({
        mode: "minimize",
        bigPictureOpen: true,
        gamesRunning: true,
        launchingGames: true,
        suspendedBy: "minimize",
        gamesRunningChangedToTrue: true,
        launchTransitionedToActive: false,
      }),
      "none"
    );

    // Launch failure before process detection restores Big Picture.
    assert.equal(
      resolveBigPictureGameWindowTransition({
        mode: "minimize",
        bigPictureOpen: true,
        gamesRunning: false,
        launchingGames: false,
        suspendedBy: "minimize",
        gamesRunningChangedToTrue: false,
        launchTransitionedToActive: false,
      }),
      "restore"
    );
  });
});
