import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { JSDOM } from "jsdom";

import {
  TRAILER_MUTED_STORAGE_KEY,
  TRAILER_VOLUME_STORAGE_KEY,
  readStoredTrailerMuted,
  readStoredTrailerVolume,
  shouldPauseOnToggle,
  shouldSpaceTogglePlayback,
  writeTrailerAudioState,
} from "./gallery-playback.js";

describe("shouldPauseOnToggle", () => {
  it("pauses a trailer that is playing", () => {
    assert.equal(
      shouldPauseOnToggle({ paused: false, ended: false, pendingPlay: false }),
      true
    );
  });

  it("plays a trailer that is paused or ended", () => {
    assert.equal(
      shouldPauseOnToggle({ paused: true, ended: false, pendingPlay: false }),
      false
    );
    assert.equal(
      shouldPauseOnToggle({ paused: false, ended: true, pendingPlay: false }),
      false
    );
  });

  it("pauses a trailer whose autoplay is still waiting for metadata", () => {
    assert.equal(
      shouldPauseOnToggle({ paused: true, ended: false, pendingPlay: true }),
      true
    );
  });
});

describe("shouldSpaceTogglePlayback", () => {
  const { document } = new JSDOM(`
    <button id="outside">Outside</button>
    <div id="gallery">
      <button id="thumbnail">Thumbnail</button>
      <div class="gallery-video">
        <div id="surface"></div>
        <button id="mute">Mute</button>
        <div class="gallery-video__quality">
          <button id="quality"><span id="quality-icon"></span></button>
        </div>
      </div>
    </div>
  `).window;
  const gallery = document.getElementById("gallery");
  const byId = (id: string) => document.getElementById(id);

  it("toggles playback when nothing activatable has focus", () => {
    assert.equal(shouldSpaceTogglePlayback(document.body, gallery), true);
    assert.equal(shouldSpaceTogglePlayback(byId("surface"), gallery), true);
    assert.equal(shouldSpaceTogglePlayback(null, gallery), true);
  });

  it("toggles playback from gallery controls outside the player", () => {
    assert.equal(shouldSpaceTogglePlayback(byId("thumbnail"), gallery), true);
  });

  it("lets focused player buttons handle Space", () => {
    assert.equal(shouldSpaceTogglePlayback(byId("mute"), gallery), false);
    assert.equal(
      shouldSpaceTogglePlayback(byId("quality-icon"), gallery),
      false
    );
  });

  it("leaves Space alone for controls outside the gallery", () => {
    assert.equal(shouldSpaceTogglePlayback(byId("outside"), gallery), false);
  });
});

describe("trailer audio storage", () => {
  const createMemoryStorage = (initial: Record<string, string> = {}) => {
    const map = new Map<string, string>(Object.entries(initial));
    return {
      getItem: (key: string) => map.get(key) ?? null,
      setItem: (key: string, value: string) => {
        map.set(key, value);
      },
      removeItem: (key: string) => {
        map.delete(key);
      },
    };
  };

  it("defaults muted to true when saving is enabled and no value is stored", () => {
    const storage = createMemoryStorage();
    assert.equal(readStoredTrailerMuted(storage, true), true);
    assert.equal(readStoredTrailerVolume(storage), 1);
  });

  it("reads and writes both volume and mute status when saving is enabled", () => {
    const storage = createMemoryStorage();
    assert.equal(writeTrailerAudioState(storage, 0.4, false, true), true);
    assert.equal(storage.getItem(TRAILER_VOLUME_STORAGE_KEY), "0.4");
    assert.equal(storage.getItem(TRAILER_MUTED_STORAGE_KEY), "false");
    assert.equal(readStoredTrailerMuted(storage, true), false);
    assert.equal(readStoredTrailerVolume(storage), 0.4);
  });

  it("ignores stored mute status and does not save it when saving is disabled", () => {
    const storage = createMemoryStorage({
      [TRAILER_VOLUME_STORAGE_KEY]: "0.7",
      [TRAILER_MUTED_STORAGE_KEY]: "false",
    });

    assert.equal(readStoredTrailerMuted(storage, false), true);
    assert.equal(writeTrailerAudioState(storage, 0.5, false, false), true);
    assert.equal(storage.getItem(TRAILER_VOLUME_STORAGE_KEY), "0.5");
    assert.equal(storage.getItem(TRAILER_MUTED_STORAGE_KEY), null);
    assert.equal(writeTrailerAudioState(storage, 0.5, false, false), false);
  });
});
