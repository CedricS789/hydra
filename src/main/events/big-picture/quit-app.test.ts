import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { executeBigPictureQuitApp } from "./quit-app-handler.js";

describe("Big Picture quitApp IPC handler", () => {
  it("invokes quit once for main-frame Big Picture requests", () => {
    const mainFrame = { id: "main-frame" };
    const sender = { mainFrame };
    let quitCalls = 0;

    executeBigPictureQuitApp(
      { sender, senderFrame: mainFrame },
      {
        isBigPictureSender: (candidate) => candidate === sender,
        quit: () => {
          quitCalls += 1;
        },
      }
    );

    assert.equal(quitCalls, 1);
  });

  it("rejects requests from non-Big-Picture windows", () => {
    const mainFrame = { id: "main-frame" };
    const sender = { mainFrame };
    let quitCalls = 0;

    assert.throws(
      () =>
        executeBigPictureQuitApp(
          { sender, senderFrame: mainFrame },
          {
            isBigPictureSender: () => false,
            quit: () => {
              quitCalls += 1;
            },
          }
        ),
      /Big Picture window/
    );

    assert.equal(quitCalls, 0);
  });

  it("rejects requests from subframes even inside the Big Picture window", () => {
    const mainFrame = { id: "main-frame" };
    const subFrame = { id: "sub-frame" };
    const sender = { mainFrame };
    let quitCalls = 0;

    assert.throws(
      () =>
        executeBigPictureQuitApp(
          { sender, senderFrame: subFrame },
          {
            isBigPictureSender: () => true,
            quit: () => {
              quitCalls += 1;
            },
          }
        ),
      /Big Picture window/
    );

    assert.equal(quitCalls, 0);
  });
});
