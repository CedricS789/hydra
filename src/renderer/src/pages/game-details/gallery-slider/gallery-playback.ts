const ACTIVATABLE_CONTROL_SELECTOR = "button, a, [role='button']";
const PLAYER_SELECTOR = ".gallery-video";

export const TRAILER_VOLUME_STORAGE_KEY = "trailerVolume";
export const TRAILER_MUTED_STORAGE_KEY = "trailerMuted";

export type TrailerAudioStorage = Pick<
  Storage,
  "getItem" | "setItem" | "removeItem"
>;

const clampUnit = (value: number) => Math.min(1, Math.max(0, value));

export const readStoredTrailerVolume = (storage: TrailerAudioStorage) => {
  const stored = storage.getItem(TRAILER_VOLUME_STORAGE_KEY);
  const volume = stored === null ? Number.NaN : Number(stored);
  return Number.isFinite(volume) ? clampUnit(volume) : 1;
};

export const readStoredTrailerMuted = (
  storage: TrailerAudioStorage,
  saveMuteStatus = true
) => {
  if (!saveMuteStatus) return true;
  const stored = storage.getItem(TRAILER_MUTED_STORAGE_KEY);
  return stored === null ? true : stored === "true";
};

export const writeTrailerAudioState = (
  storage: TrailerAudioStorage,
  volume: number,
  muted: boolean,
  saveMuteStatus = true
) => {
  const normalizedVolume = clampUnit(volume);
  const volumeChanged = readStoredTrailerVolume(storage) !== normalizedVolume;
  const existingMuted = storage.getItem(TRAILER_MUTED_STORAGE_KEY);
  const mutedChanged = saveMuteStatus
    ? existingMuted !== String(muted)
    : existingMuted !== null;

  if (!volumeChanged && !mutedChanged) return false;

  if (volumeChanged || storage.getItem(TRAILER_VOLUME_STORAGE_KEY) === null) {
    storage.setItem(TRAILER_VOLUME_STORAGE_KEY, String(normalizedVolume));
  }

  if (saveMuteStatus) {
    storage.setItem(TRAILER_MUTED_STORAGE_KEY, String(muted));
  } else {
    storage.removeItem(TRAILER_MUTED_STORAGE_KEY);
  }

  return true;
};

interface PlaybackToggleState {
  paused: boolean;
  ended: boolean;
  pendingPlay: boolean;
}

export const shouldPauseOnToggle = ({
  paused,
  ended,
  pendingPlay,
}: PlaybackToggleState) => pendingPlay || (!paused && !ended);

const findActivatableControl = (target: EventTarget | null) => {
  const element = target as Element | null;
  return typeof element?.closest === "function"
    ? element.closest(ACTIVATABLE_CONTROL_SELECTOR)
    : null;
};

export const shouldSpaceTogglePlayback = (
  target: EventTarget | null,
  gallery: Element | null
) => {
  const control = findActivatableControl(target);
  if (!control) return true;
  if (!gallery?.contains(control)) return false;
  return control.closest(PLAYER_SELECTOR) === null;
};
