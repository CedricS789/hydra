import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useBlocker } from "react-router-dom";
import type {
  UserPreferences,
  UserDetails,
  UpdateProfileRequest,
} from "@types";
import {
  changedSettings,
  reviewSettings,
  settingsValueEqual,
} from "../../../../shared/settings-changes";

type DraftContext = {
  confirm: (kind: "save" | "discard", changes: string[]) => Promise<boolean>;
  preferences: UserPreferences | null;
  stage: (values: Partial<UserPreferences>) => Promise<void>;
  commit: (
    values: Partial<UserPreferences>,
    torrentConfirmation?: string
  ) => Promise<void>;
  guardNavigation: (action: () => void) => Promise<void>;
  markUnsaved: (id: string, label: string | null) => void;
  markOperation: (id: string, running: boolean) => void;
  footer: ReactNode;
  revision: number;
  profilePatch: UpdateProfileRequest;
  stageProfile: (
    values: UpdateProfileRequest,
    saved: UserDetails,
    persist: (values: UpdateProfileRequest) => Promise<unknown>
  ) => Promise<void>;
};
const context = createContext<DraftContext | null>(null);
export type SettingsSaveActionsProps = {
  dirty: boolean;
  canSave: boolean;
  busy: boolean;
  save: () => void;
  discard: () => void;
};
export const useSettingsDraft = () => useContext(context);
export const useSettingsConfirmation = () =>
  useSettingsDraft()?.confirm ?? (async () => false);

export function useSettingsProfile<
  T extends {
    userDetails: UserDetails | null;
    patchUser: (values: UpdateProfileRequest) => Promise<unknown>;
  },
>(source: T) {
  const draft = useSettingsDraft();
  const stageProfile = draft?.stageProfile;
  const profilePatch = draft?.profilePatch;
  const { userDetails: savedDetails, patchUser: persistProfile } = source;
  const patchUser = useCallback(
    async (values: UpdateProfileRequest) => {
      if (!savedDetails)
        throw new Error("Sign in before changing account settings.");
      if (stageProfile)
        await stageProfile(values, savedDetails, persistProfile);
      else await persistProfile(values);
    },
    [stageProfile, savedDetails, persistProfile]
  );
  const userDetails = useMemo(
    () =>
      savedDetails && profilePatch
        ? { ...savedDetails, ...profilePatch }
        : savedDetails,
    [savedDetails, profilePatch]
  );
  return { ...source, userDetails, patchUser };
}

export function useSettingsFormGuard(
  id: string,
  dirty: boolean,
  label: string
) {
  const draft = useSettingsDraft();
  const mark = draft?.markUnsaved;
  useEffect(() => {
    mark?.(id, dirty ? label : null);
    return () => mark?.(id, null);
  }, [mark, id, dirty, label]);
}

export function useSettingsOperationGuard(id: string, running: boolean) {
  const mark = useSettingsDraft()?.markOperation;
  useEffect(() => {
    mark?.(id, running);
    return () => mark?.(id, false);
  }, [mark, id, running]);
}

export function SettingsDraftProvider({
  children,
  onSaved,
  renderActions,
  inlineFooter = false,
  confirmationOverride,
}: {
  children: ReactNode;
  inlineFooter?: boolean;
  onSaved?: (preferences: UserPreferences | null) => void;
  renderActions?: (props: SettingsSaveActionsProps) => ReactNode;
  confirmationOverride?: (
    kind: "save" | "discard",
    changes: string[]
  ) => Promise<boolean>;
}) {
  const [saved, setSaved] = useState<UserPreferences | null>(null);
  const [patch, setPatch] = useState<Partial<UserPreferences>>({});
  const patchRef = useRef(patch);
  const [profilePatch, setProfilePatch] = useState<UpdateProfileRequest>({});
  const profileRef = useRef<UpdateProfileRequest>({});
  const profileBaseline = useRef<Record<string, unknown>>({});
  const profileSave =
    useRef<(values: UpdateProfileRequest) => Promise<unknown>>();
  const profileAccount = useRef<string>();
  const baseline = useRef<Partial<UserPreferences>>({});
  const [forms, setForms] = useState<Record<string, string>>({});
  const formsRef = useRef(forms);
  const [revision, setRevision] = useState(0);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [operations, setOperations] = useState<string[]>([]);
  const operationsRef = useRef<string[]>([]);
  const operationRunning = operations.length > 0;
  const markOperation = useCallback((id: string, running: boolean) => {
    const current = operationsRef.current;
    if (current.includes(id) === running) return;
    const next = running
      ? [...current, id]
      : current.filter((value) => value !== id);
    operationsRef.current = next;
    setOperations(next);
  }, []);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [confirmation, setConfirmation] = useState<{
    kind: "save" | "discard";
    changes: string[];
    resolve: (accepted: boolean) => void;
  } | null>(null);
  const confirmationRef = useRef<{
    kind: "save" | "discard";
    changes: string[];
    resolve: (accepted: boolean) => void;
  } | null>(null);
  const dialogRef = useRef<HTMLElement>(null);
  const returnFocus = useRef<HTMLElement | null>(null);
  const confirm = useCallback(
    (kind: "save" | "discard", changes: string[]) => {
      if (confirmationOverride) return confirmationOverride(kind, changes);
      return new Promise<boolean>((resolve) => {
        if (confirmationRef.current) {
          resolve(false);
          return;
        }
        returnFocus.current =
          document.activeElement instanceof HTMLElement
            ? document.activeElement
            : null;
        const pending = { kind, changes, resolve };
        confirmationRef.current = pending;
        setConfirmation(pending);
      });
    },
    [confirmationOverride]
  );
  const resolveConfirmation = (accepted: boolean) => {
    const pending = confirmationRef.current;
    confirmationRef.current = null;
    setConfirmation(null);
    pending?.resolve(accepted);
    returnFocus.current?.focus();
    returnFocus.current = null;
  };
  useEffect(() => {
    if (!confirmation) return;
    const dialog = dialogRef.current;
    const keepEditing = dialog?.querySelector<HTMLElement>(
      "[data-settings-review-cancel]"
    );
    keepEditing?.focus();
    const listener = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        resolveConfirmation(false);
        return;
      }
      if (event.key === "Tab" && dialog) {
        const focusable = [
          ...dialog.querySelectorAll<HTMLElement>(
            'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
          ),
        ];
        const first = focusable[0];
        const last = focusable.at(-1);
        if (!first || !last) {
          event.preventDefault();
          return;
        }
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      }
    };
    window.addEventListener("keydown", listener);
    return () => window.removeEventListener("keydown", listener);
  }, [confirmation]);
  const alive = useRef(true);
  const closing = useRef(false);
  const dirty =
    Object.keys(patch).length > 0 ||
    Object.keys(profilePatch).length > 0 ||
    Object.keys(forms).length > 0;
  const dirtyRef = useRef(dirty);
  dirtyRef.current = dirty;
  const blocker = useBlocker(dirty || busy || operationRunning);

  useEffect(() => {
    alive.current = true;
    let receivedUpdate = false;
    const off = window.electron.onUserPreferencesUpdated((preferences) => {
      receivedUpdate = true;
      if (alive.current) setSaved(preferences);
    });
    void window.electron
      .getUserPreferences()
      .then((preferences) => {
        if (alive.current && !receivedUpdate) setSaved(preferences);
      })
      .catch((e) => {
        if (alive.current) setError(String(e));
      });
    return () => {
      alive.current = false;
      off();
    };
  }, []);

  const markUnsaved = useCallback((id: string, label: string | null) => {
    const current = formsRef.current;
    if ((current[id] ?? null) === label) return;
    const next = { ...current };
    if (label) next[id] = label;
    else delete next[id];
    formsRef.current = next;
    setForms(next);
    dirtyRef.current =
      Object.keys(next).length > 0 ||
      Object.keys(patchRef.current).length > 0 ||
      Object.keys(profileRef.current).length > 0;
  }, []);

  const stage = useCallback(
    async (values: Partial<UserPreferences>) => {
      if (busyRef.current) return;
      const currentSaved =
        saved ?? (await window.electron.getUserPreferences());
      setError("");
      setMessage("");
      const current = patchRef.current;
      const next = { ...current };
      for (const [key, value] of Object.entries(values)) {
        if (!Object.hasOwn(current, key))
          baseline.current[key] = currentSaved?.[key];
        if (settingsValueEqual(baseline.current[key], value)) {
          delete next[key];
          delete baseline.current[key];
        } else next[key] = value;
      }
      patchRef.current = next;
      dirtyRef.current =
        Object.keys(next).length > 0 ||
        Object.keys(profileRef.current).length > 0 ||
        Object.keys(formsRef.current).length > 0;
      setPatch(next);
    },
    [saved]
  );

  const stageProfile = useCallback(
    async (
      values: UpdateProfileRequest,
      original: UserDetails,
      persist: (values: UpdateProfileRequest) => Promise<unknown>
    ) => {
      if (busyRef.current) return;
      setError("");
      setMessage("");
      profileSave.current = persist;
      profileAccount.current = original.id;
      const next = { ...profileRef.current };
      for (const [key, value] of Object.entries(values)) {
        if (!Object.hasOwn(next, key))
          profileBaseline.current[key] = original[key];
        if (settingsValueEqual(profileBaseline.current[key], value)) {
          delete next[key];
          delete profileBaseline.current[key];
        } else next[key] = value;
      }
      profileRef.current = next;
      setProfilePatch(next);
      dirtyRef.current =
        Object.keys(next).length > 0 ||
        Object.keys(patchRef.current).length > 0 ||
        Object.keys(formsRef.current).length > 0;
    },
    []
  );

  const reset = useCallback(() => {
    setPatch({});
    patchRef.current = {};
    baseline.current = {};
    setForms({});
    formsRef.current = {};
    dirtyRef.current = false;
    setProfilePatch({});
    profileRef.current = {};
    profileBaseline.current = {};
    setRevision((value) => value + 1);
    setError("");
    setMessage("");
  }, []);

  const descriptions = useMemo(
    () => [
      ...reviewSettings(patch),
      ...Object.keys(profilePatch).map((key) => {
        const value = profilePatch[key];
        const selection =
          typeof value === "boolean"
            ? `: ${value ? "On" : "Off"}`
            : ["PUBLIC", "PRIVATE", "FRIENDS", "EVERYONE", "NOBODY"].includes(
                  String(value)
                )
              ? `: ${String(value)}`
              : "";
        return `Account: ${key.replace(/([a-z])([A-Z])/g, "$1 $2")}${selection} (changes online profile or privacy)`;
      }),
      ...Object.values(forms).map(
        (label) => `${label} (use its own Save button)`
      ),
    ],
    [patch, profilePatch, forms]
  );

  const guardNavigation = useCallback(
    async (action: () => void) => {
      if (busyRef.current) return;
      if (operationsRef.current.length) {
        setError(
          "Wait for the current settings operation to finish before leaving or discarding edits."
        );
        return;
      }
      if (!dirtyRef.current) {
        action();
        return;
      }
      busyRef.current = true;
      setBusy(true);
      try {
        if (await confirm("discard", descriptions)) {
          reset();
          action();
        }
      } catch (e) {
        setError(String(e));
      } finally {
        busyRef.current = false;
        if (alive.current) setBusy(false);
      }
    },
    [descriptions, reset, confirm]
  );

  useEffect(() => {
    if (blocker.state !== "blocked" || busyRef.current) return;
    let proceeded = false;
    void guardNavigation(() => {
      proceeded = true;
      blocker.proceed();
    }).finally(() => {
      if (!proceeded) blocker.reset();
    });
  }, [blocker, guardNavigation, busy, operationRunning]);

  useEffect(() => {
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (
        closing.current ||
        (!dirtyRef.current && !busyRef.current && !operationsRef.current.length)
      )
        return;
      event.preventDefault();
      event.returnValue = false as unknown as string;
      void guardNavigation(() => {
        closing.current = true;
        window.close();
      });
    };
    window.addEventListener("beforeunload", beforeUnload);
    return () => window.removeEventListener("beforeunload", beforeUnload);
  }, [guardNavigation]);

  const persist = useCallback(
    async (values: Partial<UserPreferences>, torrentConfirmation?: string) => {
      await window.electron.updateUserPreferences(values, torrentConfirmation);
      const latest = await window.electron.getUserPreferences();
      setSaved(latest);
      onSaved?.(latest);
    },
    [onSaved]
  );

  // For forms that already have their own Save button (e.g. provider tokens).
  const commit = useCallback(
    async (values: Partial<UserPreferences>, torrentConfirmation?: string) => {
      if (busyRef.current)
        throw new Error("A settings operation is already in progress.");
      busyRef.current = true;
      setBusy(true);
      try {
        const latest = await window.electron.getUserPreferences();
        const changes = changedSettings(latest, values);
        if (!Object.keys(changes).length) return;
        if (!(await confirm("save", reviewSettings(changes))))
          throw new Error(
            "Changes were not saved. Keep editing or discard them."
          );
        await persist(changes, torrentConfirmation);
      } finally {
        busyRef.current = false;
        if (alive.current) setBusy(false);
      }
    },
    [persist, confirm]
  );

  const save = async () => {
    if (operationsRef.current.length) return;
    if (Object.keys(formsRef.current).length) {
      setError(
        "Save or discard the edits in the listed sections before applying other preferences."
      );
      return;
    }
    if (
      busyRef.current ||
      (!Object.keys(patch).length && !Object.keys(profilePatch).length)
    )
      return;
    busyRef.current = true;
    setBusy(true);
    setError("");
    setMessage("");
    const submitted = { ...patch };
    try {
      if (
        !(await confirm(
          "save",
          descriptions.filter(
            (item) => !item.endsWith("(use its own Save button)")
          )
        ))
      )
        return;
      const latest = await window.electron.getUserPreferences();
      const conflicts = Object.keys(submitted).filter(
        (key) =>
          !settingsValueEqual(latest?.[key], baseline.current[key]) &&
          !settingsValueEqual(latest?.[key], submitted[key])
      );
      if (conflicts.length)
        throw new Error(
          "These settings changed in another window. Discard your edits, review the current settings, and try again."
        );
      if (Object.keys(profilePatch).length) {
        const account = await window.electron.getMe();
        if (
          !account ||
          account.id !== profileAccount.current ||
          Object.keys(profilePatch).some(
            (key) =>
              !settingsValueEqual(account[key], profileBaseline.current[key]) &&
              !settingsValueEqual(account[key], profilePatch[key])
          )
        )
          throw new Error(
            "The account or its settings changed. Discard edits and review the current account before retrying."
          );
      }
      if (Object.keys(submitted).length) {
        await persist(submitted);
        setPatch({});
        patchRef.current = {};
        baseline.current = {};
      }
      if (Object.keys(profilePatch).length && profileSave.current) {
        await profileSave.current(profilePatch);
        setProfilePatch({});
        profileRef.current = {};
        profileBaseline.current = {};
      }
      setMessage("Settings saved.");
    } catch (e) {
      setError(
        `Saving settings did not complete. Review any remaining edits: ${String(e)}`
      );
    } finally {
      busyRef.current = false;
      if (alive.current) setBusy(false);
    }
  };

  const preferences = useMemo(
    () =>
      saved || Object.keys(patch).length
        ? ({ ...saved, ...patch } as UserPreferences)
        : null,
    [saved, patch]
  );
  const footer = (
    <div
      className={`settings-save-bar ${inlineFooter ? "settings-save-bar--inline" : "settings-save-bar--floating"} ${renderActions ? "settings-save-bar--big-picture" : ""}`}
      role="region"
      aria-label="Save settings"
    >
      <div aria-live="polite">
        {error ? (
          <p role="alert">{error}</p>
        ) : (
          <p>
            {message ||
              (dirty
                ? "You have unsaved edits."
                : "Changes take effect only after saving.")}
          </p>
        )}
        {Object.keys(forms).length > 0 && (
          <small>
            These sections have their own Save buttons:{" "}
            {Object.values(forms).join(", ")}.
          </small>
        )}
      </div>
      {renderActions ? (
        renderActions({
          dirty,
          canSave:
            Object.keys(forms).length === 0 &&
            Boolean(
              Object.keys(patch).length || Object.keys(profilePatch).length
            ),
          busy: busy || operationRunning,
          save: () => void save(),
          discard: () => void guardNavigation(() => {}),
        })
      ) : (
        <>
          <button
            type="button"
            disabled={!dirty || busy || operationRunning}
            onClick={() => void guardNavigation(() => {})}
          >
            Discard edits
          </button>
          <button
            type="button"
            disabled={
              Object.keys(forms).length > 0 ||
              (!Object.keys(patch).length &&
                !Object.keys(profilePatch).length) ||
              busy ||
              operationRunning
            }
            onClick={() => void save()}
          >
            {busy ? "Please wait…" : "Save changes"}
          </button>
        </>
      )}
    </div>
  );
  return (
    <context.Provider
      value={{
        confirm,
        preferences,
        stage,
        commit,
        guardNavigation,
        markUnsaved,
        markOperation,
        revision,
        profilePatch,
        stageProfile,
        footer,
      }}
    >
      {children}
      {confirmation && (
        <div className="settings-review__backdrop">
          <section
            ref={dialogRef}
            className="settings-review"
            role="dialog"
            aria-modal="true"
            aria-labelledby="settings-review-title"
          >
            <div className="settings-review__accent" />
            <header>
              <h2 id="settings-review-title">
                {confirmation.kind === "save"
                  ? "Review settings changes"
                  : "Unsaved settings"}
              </h2>
              <button
                type="button"
                aria-label="Keep editing"
                onClick={() => resolveConfirmation(false)}
              >
                ×
              </button>
            </header>
            <p>
              {confirmation.kind === "save"
                ? "Save these changes?"
                : "Discard unsaved edits and continue?"}
            </p>
            <ul>
              {confirmation.changes.map((change, index) => (
                <li key={`${index}-${change}`}>{change}</li>
              ))}
            </ul>
            <footer>
              <button
                data-settings-review-cancel
                type="button"
                onClick={() => resolveConfirmation(false)}
              >
                Keep editing
              </button>
              <button
                className={
                  confirmation.kind === "save"
                    ? "settings-review__primary"
                    : "settings-review__danger"
                }
                type="button"
                onClick={() => resolveConfirmation(true)}
              >
                {confirmation.kind === "save"
                  ? "Save changes"
                  : "Discard edits"}
              </button>
            </footer>
          </section>
        </div>
      )}
      {!inlineFooter && footer}
    </context.Provider>
  );
}

export function SettingsSaveBar() {
  return <>{useSettingsDraft()?.footer}</>;
}
