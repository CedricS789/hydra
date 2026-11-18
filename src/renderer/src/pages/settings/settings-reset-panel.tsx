import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ComponentType,
  type ReactNode,
} from "react";
import type { LibraryGame } from "@types";
import {
  useSettingsDraft,
  useSettingsOperationGuard,
} from "@renderer/context/settings/settings-draft.context";
import {
  SETTINGS_RESET_GROUPS,
  type SettingsResetGroup,
  type SettingsResetPreview,
  type SettingsResetStatus,
  type SettingsResetTarget,
} from "../../../../shared/settings-reset";
import "./settings-reset.scss";

type Children = { children: ReactNode };
export interface ResetControls {
  Button: ComponentType<
    Children & { disabled?: boolean; onClick: () => void; focusId?: string }
  >;
  Check: ComponentType<{
    label: string;
    checked: boolean;
    disabled?: boolean;
    onChange: (checked: boolean) => void;
  }>;
  Input: ComponentType<{
    label: string;
    value: string;
    disabled?: boolean;
    onChange: (value: string) => void;
  }>;
  Select: ComponentType<{
    label: string;
    value: string;
    disabled?: boolean;
    options: { value: string; label: string }[];
    onChange: (value: string) => void;
  }>;
  Dialog: ComponentType<
    Children & { title: string; busy: boolean; onClose: () => void }
  >;
  Stack: ComponentType<Children>;
  Actions?: ComponentType<Children & { className?: string }>;
}

const DefaultActions = ({
  children,
  className,
}: Children & { className?: string }) => (
  <div className={className}>{children}</div>
);
const groups: {
  group: SettingsResetGroup;
  title: string;
  description: string;
}[] = [
  {
    group: "combined",
    title: "Reset app preferences",
    description:
      "Reset ordinary app behavior and presentation together. Preserve language, folders, privacy, accounts, save configuration and game rules.",
  },
  ...Object.entries(SETTINGS_RESET_GROUPS).map(([group, value]) => ({
    group: group as SettingsResetGroup,
    ...value,
  })),
  {
    group: "backups",
    title: "Automatic backup behavior",
    description:
      "Enable automatic backups; use 10 full versions, no differential versions, a 10-second exit delay, and ZIP/deflate. Keep the destination and game rules.",
  },
];
const keyOf = (target: SettingsResetTarget) => JSON.stringify(target);

export function SettingsResetPanel({
  controls: UI,
}: {
  controls: ResetControls;
}) {
  const ActionsGroup = UI.Actions ?? DefaultActions;
  const draft = useSettingsDraft();
  const [statuses, setStatuses] = useState<Record<string, SettingsResetStatus>>(
    {}
  );
  const [statusErrors, setStatusErrors] = useState<Record<string, string>>({});
  const [games, setGames] = useState<LibraryGame[]>([]);
  const [gameKey, setGameKey] = useState("");
  const [preview, setPreview] = useState<SettingsResetPreview | null>(null);
  const [reviewExpired, setReviewExpired] = useState(false);
  const [ack, setAck] = useState(false);
  const [phrase, setPhrase] = useState("");
  const [torrentPhrase, setTorrentPhrase] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const mounted = useRef(true);
  const active = useRef(false);
  const generation = useRef(0);
  const reviewBody = useRef<HTMLDivElement>(null);
  const returnFocus = useRef<HTMLElement | null>(null);
  useSettingsOperationGuard("settings-reset", busy);
  const locked =
    !draft ||
    draft.hasUnsavedChanges ||
    busy ||
    (!preview && draft.hasRunningOperation);

  const refresh = useCallback(async () => {
    const request = ++generation.current;
    const targets: SettingsResetTarget[] = groups.map(({ group }) => ({
      group,
    }));
    if (gameKey) targets.push({ group: "gameRules", gameKey });
    const results = await Promise.allSettled(
      targets.map((target) => window.electron.getSettingsResetStatus(target))
    );
    if (!mounted.current || request !== generation.current) return;
    const next: Record<string, SettingsResetStatus> = {};
    const errors: Record<string, string> = {};
    results.forEach((result, index) => {
      const key = keyOf(targets[index]);
      if (result.status === "fulfilled") next[key] = result.value;
      else errors[key] = String(result.reason);
    });
    setStatuses(next);
    setStatusErrors(errors);
  }, [gameKey]);

  useEffect(() => {
    mounted.current = true;
    void window.electron
      .getLibrary(true)
      .then((library) => {
        if (mounted.current)
          setGames(
            library
              .filter((game) => !game.isDeleted)
              .sort((a, b) => a.title.localeCompare(b.title))
          );
      })
      .catch((e) => {
        if (mounted.current)
          setError(`Could not load library games: ${String(e)}`);
      });
    return () => {
      mounted.current = false;
      generation.current += 1;
    };
  }, []);
  useEffect(() => {
    void refresh();
    const unsubscribers = [
      window.electron.onUserPreferencesUpdated,
      window.electron.onLudusaviStateChanged,
      window.electron.onCustomThemeUpdated,
      window.electron.onGamesRunning,
    ].map((subscribe) => subscribe?.(() => void refresh()));
    return () => {
      generation.current += 1;
      unsubscribers.forEach((unsubscribe) => unsubscribe?.());
    };
  }, [refresh, draft?.revision]);

  // Desktop focus containment; Big Picture also uses its native modal navigation layer.
  useEffect(() => {
    if (!preview) return;
    setReviewExpired(false);
    const expiry = window.setTimeout(
      () => setReviewExpired(true),
      Math.max(0, preview.expiresAt - Date.now())
    );
    const frame = requestAnimationFrame(() =>
      document.getElementById("settings-reset-cancel")?.focus()
    );
    const trap = (event: KeyboardEvent) => {
      if (event.key !== "Tab" || event.defaultPrevented) return;
      const dialog = reviewBody.current?.closest('[role="dialog"]');
      const elements = Array.from(
        dialog?.querySelectorAll<HTMLElement>(
          'button:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex="0"]'
        ) ?? []
      );
      if (!elements.length) return;
      const first = elements[0],
        last = elements[elements.length - 1];
      if (
        event.shiftKey &&
        (document.activeElement === first ||
          !dialog?.contains(document.activeElement))
      ) {
        event.preventDefault();
        last.focus();
      } else if (
        !event.shiftKey &&
        (document.activeElement === last ||
          !dialog?.contains(document.activeElement))
      ) {
        event.preventDefault();
        first.focus();
      }
    };
    window.addEventListener("keydown", trap);
    return () => {
      window.clearTimeout(expiry);
      cancelAnimationFrame(frame);
      window.removeEventListener("keydown", trap);
    };
  }, [preview]);

  const prepare = async (target: SettingsResetTarget, restoring: boolean) => {
    if (locked || active.current) return;
    returnFocus.current =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    active.current = true;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const review = await window.electron.previewSettingsReset(
        target,
        restoring
      );
      if (mounted.current) {
        setAck(false);
        setPhrase("");
        setTorrentPhrase("");
        setPreview(review);
      }
    } catch (e) {
      if (mounted.current) setError(String(e));
    } finally {
      active.current = false;
      if (mounted.current) setBusy(false);
    }
  };
  const close = () => {
    if (!active.current) {
      setPreview(null);
      setAck(false);
      setPhrase("");
      setTorrentPhrase("");
      requestAnimationFrame(() => returnFocus.current?.focus());
    }
  };
  const expired =
    reviewExpired || (preview ? Date.now() >= preview.expiresAt : false);
  const confirmed =
    preview &&
    (!preview.confirmationPhrase ||
      (ack && phrase === preview.confirmationPhrase)) &&
    (!preview.directTorrentConfirmation ||
      (ack && torrentPhrase === "ENABLE DIRECT TORRENTS"));
  const apply = async () => {
    if (
      !preview ||
      !confirmed ||
      locked ||
      active.current ||
      (!preview.changes.length && !preview.retryingInterrupted) ||
      expired
    )
      return;
    active.current = true;
    setBusy(true);
    setError("");
    let applied = false;
    try {
      await window.electron.applySettingsReset(
        preview.token,
        ack,
        phrase,
        torrentPhrase || undefined
      );
      applied = true;
      if (mounted.current) {
        setMessage(
          preview.restoring
            ? "Previous settings restored."
            : "Reset saved. You can restore the previous settings below."
        );
        setPreview(null);
      }
    } catch (e) {
      if (mounted.current) {
        setError(String(e));
        setPreview(null);
      }
    } finally {
      try {
        await draft?.reloadSavedPreferences();
        await refresh();
      } catch (e) {
        if (mounted.current)
          setError(
            `${applied ? "The reset was saved, but the display could not refresh." : "Could not refresh settings."} ${String(e)}`
          );
      }
      active.current = false;
      if (mounted.current) setBusy(false);
    }
  };

  const actions = (target: SettingsResetTarget) => {
    const status = statuses[keyOf(target)];
    const statusError = statusErrors[keyOf(target)];
    return (
      <>
        {statusError && <p role="alert">{statusError}</p>}
        {status?.blockedReason && <p>{status.blockedReason}</p>}
        <ActionsGroup className="settings-reset__actions">
          <UI.Button
            disabled={
              locked ||
              !status ||
              status.isDefault ||
              Boolean(status.blockedReason)
            }
            onClick={() => void prepare(target, false)}
          >
            {status?.isDefault ? "Already using defaults" : "Review reset"}
          </UI.Button>
          {status?.recovery && (
            <UI.Button
              disabled={locked || Boolean(status.blockedReason)}
              onClick={() => void prepare(target, true)}
            >
              Restore previous settings
            </UI.Button>
          )}
        </ActionsGroup>
        {status?.recovery && (
          <p className="settings-reset__hint">
            {status.recovery.interrupted
              ? "Recovery from an interrupted reset"
              : "Recovery snapshot"}
            : {new Date(status.recovery.savedAt).toLocaleString()}
          </p>
        )}
      </>
    );
  };

  return (
    <UI.Stack>
      <div className="settings-reset">
        <h3>Reset and recovery</h3>
        <p>
          Review changes before saving a reset. Each reset keeps one local
          recovery snapshot. Recovery restores settings only, never game saves.
        </p>
        <p className="settings-reset__hint">
          Language, folders, credentials, accounts, website profiles and
          cookies, download-source feeds, library entries and exclusions are
          preserved. Privacy choices are kept except when explicitly resetting
          Social visibility.
        </p>
        {draft?.hasUnsavedChanges && (
          <p role="status">
            Save or discard your existing edits before resetting settings.
          </p>
        )}
        {busy && <p role="status">Working… Please wait.</p>}
        {error && (
          <p className="settings-reset__error" role="alert">
            {error}
          </p>
        )}
        {message && <p role="status">{message}</p>}
        <div className="settings-reset__toolbar">
          <UI.Button disabled={busy} onClick={() => void refresh()}>
            Refresh reset status
          </UI.Button>
        </div>
        {groups.map(({ group, title, description }) => (
          <section className="settings-reset__card" key={group}>
            <h4>{title}</h4>
            <p>{description}</p>
            {actions({ group })}
          </section>
        ))}
        <section className="settings-reset__card">
          <h4>One game’s custom backup rules</h4>
          <p>
            Reset only the selected game’s paths, tracking and matching
            overrides; enable its automatic backups. Advanced YAML rules and
            backup files are kept.
          </p>
          <UI.Select
            label="Game"
            value={gameKey}
            disabled={busy || Boolean(preview)}
            options={[
              { value: "", label: "Select a game…" },
              ...games.map((game) => ({
                value: `${game.shop}:${game.objectId}`,
                label: game.title,
              })),
            ]}
            onChange={(value) => {
              setGameKey(value);
              setError("");
            }}
          />
          {gameKey && actions({ group: "gameRules", gameKey })}
        </section>
        {preview && (
          <UI.Dialog
            title={
              preview.restoring
                ? "Review settings recovery"
                : "Review settings reset"
            }
            busy={busy}
            onClose={close}
          >
            <UI.Stack>
              <div ref={reviewBody} className="settings-reset__review">
                <h4>
                  {preview.target.group === "gameRules"
                    ? games.find(
                        (game) =>
                          `${game.shop}:${game.objectId}` ===
                          preview.target.gameKey
                      )?.title
                    : groups.find(
                        (group) => group.group === preview.target.group
                      )?.title}
                </h4>
                {preview.warnings.map((warning) => (
                  <p key={warning}>{warning}</p>
                ))}
                {preview.changes.length ? (
                  <div className="settings-reset__table">
                    <table>
                      <thead>
                        <tr>
                          <th>Setting</th>
                          <th>Current</th>
                          <th>Proposed</th>
                        </tr>
                      </thead>
                      <tbody>
                        {preview.changes.map((change) => (
                          <tr key={change.key}>
                            <td>{change.label}</td>
                            <td>{change.before}</td>
                            <td>{change.after}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <p>
                    {preview.retryingInterrupted
                      ? "Stored values already match. Recovery will reapply them to retry system integration."
                      : "These settings already match. Nothing needs to change."}
                  </p>
                )}
                {(preview.confirmationPhrase ||
                  preview.directTorrentConfirmation) && (
                  <UI.Check
                    label="I reviewed the changes and understand their effects."
                    checked={ack}
                    disabled={busy}
                    onChange={setAck}
                  />
                )}
                {preview.confirmationPhrase && (
                  <UI.Input
                    label={`Type ${preview.confirmationPhrase} to confirm`}
                    value={phrase}
                    disabled={busy}
                    onChange={setPhrase}
                  />
                )}
                {preview.directTorrentConfirmation && (
                  <UI.Input
                    label="Type ENABLE DIRECT TORRENTS to allow direct peer-to-peer access"
                    value={torrentPhrase}
                    disabled={busy}
                    onChange={setTorrentPhrase}
                  />
                )}
                {expired && (
                  <p role="alert">
                    This review expired. Cancel and review again.
                  </p>
                )}
                <ActionsGroup className="settings-reset__actions">
                  <UI.Button
                    focusId="settings-reset-cancel"
                    disabled={busy}
                    onClick={close}
                  >
                    Cancel
                  </UI.Button>
                  <UI.Button
                    disabled={
                      locked ||
                      !confirmed ||
                      expired ||
                      (!preview.changes.length && !preview.retryingInterrupted)
                    }
                    onClick={() => void apply()}
                  >
                    {preview.restoring
                      ? "Restore previous settings"
                      : "Apply reset"}
                  </UI.Button>
                </ActionsGroup>
              </div>
            </UI.Stack>
          </UI.Dialog>
        )}
      </div>
    </UI.Stack>
  );
}
