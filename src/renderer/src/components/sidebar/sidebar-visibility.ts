export const SIDEBAR_HIDDEN_STORAGE_KEY = "sidebarHidden";

const getSafeStorage = (): Storage | null => {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
};

/** Reads the persisted collapsed state of the main navigation sidebar. */
export const readStoredSidebarHidden = (
  storage: Pick<Storage, "getItem"> | null = getSafeStorage()
): boolean => {
  try {
    return storage?.getItem(SIDEBAR_HIDDEN_STORAGE_KEY) === "true";
  } catch {
    return false;
  }
};

/** Persists the collapsed state of the main navigation sidebar. */
export const writeStoredSidebarHidden = (
  hidden: boolean,
  storage: Pick<Storage, "setItem"> | null = getSafeStorage()
): void => {
  try {
    storage?.setItem(SIDEBAR_HIDDEN_STORAGE_KEY, String(hidden));
  } catch {
    // Ignore storage quota or private mode errors.
  }
};

export interface SidebarShortcutTargetLike {
  tagName?: string;
  isContentEditable?: boolean;
  closest?: (selector: string) => unknown;
}

export interface SidebarShortcutEventLike {
  key: string;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
  repeat?: boolean;
  target: EventTarget | SidebarShortcutTargetLike | null;
}

const EDITABLE_TAGS = new Set(["INPUT", "TEXTAREA", "SELECT"]);

const isEditableTarget = (
  target: EventTarget | SidebarShortcutTargetLike | null
): boolean => {
  if (!target || typeof target !== "object") return false;

  const element = target as SidebarShortcutTargetLike;
  if (element.isContentEditable) return true;
  if (element.tagName && EDITABLE_TAGS.has(element.tagName.toUpperCase())) {
    return true;
  }

  return Boolean(
    element.closest?.(
      'input, textarea, select, [contenteditable="true"], .monaco-editor'
    )
  );
};

/**
 * Matches Ctrl+B (or Cmd+B on macOS) when focus is not inside an editable field.
 */
export const isSidebarToggleShortcut = (
  event: SidebarShortcutEventLike,
  platform: string
): boolean => {
  if (event.repeat || event.altKey || event.shiftKey) return false;
  if (event.key.toLowerCase() !== "b") return false;

  const hasPrimaryModifier =
    platform === "darwin"
      ? event.metaKey && !event.ctrlKey
      : event.ctrlKey && !event.metaKey;

  if (!hasPrimaryModifier) return false;

  return !isEditableTarget(event.target);
};
