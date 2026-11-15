import assert from "node:assert/strict";
import { it } from "node:test";
import {
  allowsDirectTorrent,
  validateDirectTorrentChange,
  DIRECT_TORRENT_CONFIRMATION,
} from "./direct-torrent-policy.js";

it("fresh, upgraded, and malformed preferences never opt in implicitly", () => {
  for (const value of [
    null,
    undefined,
    {},
    { allowDirectTorrent: false },
    { allowDirectTorrent: "true" },
    { allowDirectTorrent: 1 },
  ])
    assert.equal(allowsDirectTorrent(value), false);
  assert.equal(allowsDirectTorrent({ allowDirectTorrent: true }), true);
});
it("enabling requires the exact confirmation; disabling and unrelated updates do not", () => {
  for (const confirmation of [
    undefined,
    "",
    "enable",
    "enable direct torrents",
  ])
    assert.throws(() =>
      validateDirectTorrentChange(
        null,
        { allowDirectTorrent: true },
        confirmation
      )
    );
  validateDirectTorrentChange(
    null,
    { allowDirectTorrent: true },
    DIRECT_TORRENT_CONFIRMATION
  );
  validateDirectTorrentChange(
    { allowDirectTorrent: true },
    { allowDirectTorrent: false }
  );
  validateDirectTorrentChange(null, {});
  assert.throws(() =>
    validateDirectTorrentChange(
      null,
      { allowDirectTorrent: "true" },
      DIRECT_TORRENT_CONFIRMATION
    )
  );
});
