import {
  useSettingsOperationGuard,
  useSettingsConfirmation,
  useSettingsFormGuard,
} from "@renderer/context/settings/settings-draft.context";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { ChevronDownIcon } from "@primer/octicons-react";
import { GripVertical } from "lucide-react";
import { combine } from "@atlaskit/pragmatic-drag-and-drop/combine";
import {
  draggable,
  dropTargetForElements,
  monitorForElements,
} from "@atlaskit/pragmatic-drag-and-drop/element/adapter";
import cn from "classnames";
import { Button, TextField } from "@renderer/components";
import type { DownloadSource } from "@types";
import type { SourceWebsiteProfile } from "../../../../types/source-browser.types";
import {
  orderSourceWebsiteProfiles,
  suggestedWebsiteProfile,
} from "../../../../shared/source-browser-policy";
import { settingsValueEqual } from "../../../../shared/settings-changes";
import {
  getClosestVerticalEdge,
  getReorderFinishIndex,
  moveOrderItem,
  reorderWebsiteOrder,
  type DropEdge,
} from "./source-website-order";

const WEBSITE_ORDER_DRAG_TYPE = "source-website-order";
const WEBSITE_ORDER_DROP_TYPE = "source-website-order-target";

type WebsiteOrderDragData = {
  type: typeof WEBSITE_ORDER_DRAG_TYPE;
  id: string;
};

type WebsiteOrderDropData = {
  type: typeof WEBSITE_ORDER_DROP_TYPE;
  id: string;
};

const isWebsiteOrderDragData = (
  data: Record<string | symbol, unknown>
): data is Record<string | symbol, unknown> & WebsiteOrderDragData =>
  data.type === WEBSITE_ORDER_DRAG_TYPE && typeof data.id === "string";

const isWebsiteOrderDropData = (
  data: Record<string | symbol, unknown>
): data is Record<string | symbol, unknown> & WebsiteOrderDropData =>
  data.type === WEBSITE_ORDER_DROP_TYPE && typeof data.id === "string";

interface SortableWebsiteProfileCardProps {
  id: string;
  label: string;
  orderIndex: number;
  reorderableCount: number;
  canReorder: boolean;
  isSaved: boolean;
  isOpen: boolean;
  isDragging: boolean;
  dropEdge: DropEdge | null;
  onToggleOpen: () => void;
  onMove: (startIndex: number, finishIndex: number) => void;
  children: ReactNode;
}

function SortableWebsiteProfileCard({
  id,
  label,
  orderIndex,
  reorderableCount,
  canReorder,
  isSaved,
  isOpen,
  isDragging,
  dropEdge,
  onToggleOpen,
  onMove,
  children,
}: Readonly<SortableWebsiteProfileCardProps>) {
  const rowRef = useRef<HTMLLIElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const headerRef = useRef<HTMLDivElement>(null);
  const handleRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const rowElement = rowRef.current;
    const cardElement = cardRef.current;
    const headerElement = headerRef.current;
    if (!rowElement || !cardElement || !headerElement || !canReorder) return;

    return combine(
      dropTargetForElements({
        element: rowElement,
        canDrop: ({ source }) => isWebsiteOrderDragData(source.data),
        getData: (): WebsiteOrderDropData => ({
          type: WEBSITE_ORDER_DROP_TYPE,
          id,
        }),
      }),
      draggable({
        element: cardElement,
        dragHandle: headerElement,
        getInitialData: (): WebsiteOrderDragData => ({
          type: WEBSITE_ORDER_DRAG_TYPE,
          id,
        }),
      })
    );
  }, [canReorder, id]);

  const handleKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (!canReorder || orderIndex < 0) return;
    if (event.key === "ArrowUp" && orderIndex > 0) {
      event.preventDefault();
      onMove(orderIndex, orderIndex - 1);
      requestAnimationFrame(() => handleRef.current?.focus());
    } else if (event.key === "ArrowDown" && orderIndex < reorderableCount - 1) {
      event.preventDefault();
      onMove(orderIndex, orderIndex + 1);
      requestAnimationFrame(() => handleRef.current?.focus());
    }
  };

  return (
    <li
      ref={rowRef}
      className={cn("settings-source-websites__order-item", {
        "settings-source-websites__order-item--drop-top": dropEdge === "top",
        "settings-source-websites__order-item--drop-bottom":
          dropEdge === "bottom",
      })}
    >
      <div
        ref={cardRef}
        className={cn("settings-source-websites__profile", {
          "settings-source-websites__profile--open": isOpen,
          "settings-source-websites__profile--dragging": isDragging,
        })}
      >
        <div
          ref={headerRef}
          className={cn("settings-source-websites__profile-header", {
            "settings-source-websites__profile-header--draggable": canReorder,
          })}
        >
          <button
            ref={handleRef}
            type="button"
            disabled={!canReorder}
            title={
              canReorder
                ? "Drag to reorder, or use Arrow Up / Arrow Down"
                : isSaved
                  ? undefined
                  : "Save this website profile first to include it in search button order"
            }
            aria-label={
              canReorder
                ? `Reorder ${label}, position ${orderIndex + 1} of ${reorderableCount}. Drag or press Arrow Up or Arrow Down.`
                : `${label} cannot be reordered yet`
            }
            onKeyDown={handleKeyDown}
            className="settings-source-websites__drag-handle"
          >
            <GripVertical size={16} aria-hidden="true" />
          </button>
          <button
            type="button"
            aria-expanded={isOpen}
            onClick={onToggleOpen}
            className="settings-source-websites__profile-toggle"
          >
            <span className="settings-source-websites__profile-title">
              {label}
            </span>
            {isSaved ? (
              orderIndex >= 0 && (
                <span className="settings-source-websites__order-index">
                  #{orderIndex + 1}
                </span>
              )
            ) : (
              <span className="settings-source-websites__profile-badge">
                Not saved
              </span>
            )}
            <ChevronDownIcon
              size={16}
              className="settings-source-websites__chevron"
              aria-hidden="true"
            />
          </button>
        </div>
        {isOpen && (
          <div className="settings-context-advanced__menu-body">{children}</div>
        )}
      </div>
    </li>
  );
}

export function SettingsSourceWebsites() {
  const confirm = useSettingsConfirmation();
  const [sources, setSources] = useState<Pick<DownloadSource, "id" | "name">[]>(
    []
  );
  const [newName, setNewName] = useState("");
  const [profiles, setProfiles] = useState<
    Record<string, SourceWebsiteProfile>
  >({});
  const [savedProfiles, setSavedProfiles] = useState<
    Record<string, SourceWebsiteProfile>
  >({});
  const [newProfiles, setNewProfiles] = useState<string[]>([]);
  const [message, setMessage] = useState("");
  const [profilesLoaded, setProfilesLoaded] = useState(false);
  const [profilesLoading, setProfilesLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  useSettingsOperationGuard("settings-source-websites", busy);
  const [confirmClear, setConfirmClear] = useState<string | null>(null);
  const [domainDrafts, setDomainDrafts] = useState<Record<string, string>>({});
  const [websiteOrder, setWebsiteOrder] = useState<string[]>([]);
  const [savedWebsiteOrder, setSavedWebsiteOrder] = useState<string[]>([]);
  const [openProfiles, setOpenProfiles] = useState<Record<string, boolean>>({});
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dropIndicator, setDropIndicator] = useState<{
    targetId: string;
    edge: DropEdge;
  } | null>(null);
  const websiteOrderRef = useRef(websiteOrder);
  websiteOrderRef.current = websiteOrder;

  const dirtySources = useMemo(
    () =>
      sources
        .filter((source) => {
          if (newProfiles.includes(source.id)) return true;
          const baseline = savedProfiles[source.id] ??
            suggestedWebsiteProfile(source.name) ?? {
              website: "",
              searchUrl: "",
            };
          const current = profiles[source.id] ?? baseline;
          const normalized = (
            profile: SourceWebsiteProfile,
            domainsText?: string
          ) => ({
            name: profile.name ?? source.name,
            website: profile.website,
            searchUrl: profile.searchUrl,
            approvedDomains: (
              domainsText ?? (profile.approvedDomains ?? []).join("\n")
            )
              .split(/\r?\n/)
              .map((domain) => domain.trim())
              .filter(Boolean),
          });
          return !settingsValueEqual(
            normalized(current, domainDrafts[source.id]),
            normalized(baseline)
          );
        })
        .map((source) => source.id),
    [sources, newProfiles, savedProfiles, profiles, domainDrafts]
  );
  useSettingsFormGuard(
    "source-profiles",
    dirtySources.length > 0,
    "Source website profiles"
  );

  const mergeProfiles = useCallback(
    (saved: Record<string, SourceWebsiteProfile>) => {
      setProfiles(saved);
      setSavedProfiles(saved);
      setProfilesLoaded(true);
      setProfilesLoading(false);
      setSources((current) => {
        const merged = new Map(current.map((source) => [source.id, source]));
        for (const [id, profile] of Object.entries(saved))
          if (!merged.has(id))
            merged.set(id, {
              id,
              name: profile.name ?? new URL(profile.website).hostname,
            });
        return [...merged.values()];
      });
    },
    []
  );

  const loadProfiles = async () => {
    setMessage("");
    setProfilesLoading(true);
    try {
      const saved = await window.electron.getSourceWebsiteProfiles();
      mergeProfiles(saved);
      const preferences = await window.electron.getUserPreferences();
      const order = orderSourceWebsiteProfiles(
        saved,
        preferences?.sourceWebsiteSearchOrder
      );
      setWebsiteOrder(order);
      setSavedWebsiteOrder(order);
    } catch (error) {
      setMessage(String(error));
      setProfilesLoaded(false);
    } finally {
      setProfilesLoading(false);
    }
  };

  useEffect(() => {
    let active = true;
    void window.electron
      .getDownloadSources()
      .then((items) => {
        if (active)
          setSources((current) => {
            const merged = new Map<string, Pick<DownloadSource, "id" | "name">>(
              items.map((item) => [item.id, item])
            );
            for (const item of current)
              if (!merged.has(item.id)) merged.set(item.id, item);
            return [...merged.values()];
          });
      })
      .catch((error) => {
        if (active)
          setMessage(`Download feeds could not be loaded: ${String(error)}`);
      });
    void Promise.all([
      window.electron.getSourceWebsiteProfiles(),
      window.electron.getUserPreferences(),
    ])
      .then(([saved, preferences]) => {
        if (active) {
          mergeProfiles(saved);
          const order = orderSourceWebsiteProfiles(
            saved,
            preferences?.sourceWebsiteSearchOrder
          );
          setWebsiteOrder(order);
          setSavedWebsiteOrder(order);
        }
      })
      .catch((error) => {
        if (active) {
          setMessage(String(error));
          setProfilesLoaded(false);
          setProfilesLoading(false);
        }
      });
    return () => {
      active = false;
    };
  }, [mergeProfiles]);

  const canReorderAny = !busy && websiteOrder.length > 1;
  useEffect(() => {
    if (!canReorderAny) {
      setDraggingId(null);
      setDropIndicator(null);
      return;
    }

    return monitorForElements({
      canMonitor: ({ source }) => isWebsiteOrderDragData(source.data),
      onDragStart: ({ source }) => {
        if (!isWebsiteOrderDragData(source.data)) return;
        setDraggingId(source.data.id);
        setDropIndicator(null);
      },
      onDrag: ({ source, location }) => {
        if (!isWebsiteOrderDragData(source.data)) return;
        const target = location.current.dropTargets[0];
        if (!target || !isWebsiteOrderDropData(target.data)) {
          setDropIndicator((current) => (current ? null : current));
          return;
        }
        const targetId = target.data.id;
        const edge = getClosestVerticalEdge(
          target.element.getBoundingClientRect(),
          location.current.input.clientY
        );
        const startIndex = websiteOrderRef.current.indexOf(source.data.id);
        const targetIndex = websiteOrderRef.current.indexOf(targetId);
        const finishIndex = getReorderFinishIndex({
          startIndex,
          targetIndex,
          edge,
        });
        if (finishIndex === startIndex) {
          setDropIndicator((current) => (current ? null : current));
          return;
        }
        setDropIndicator((current) =>
          current?.targetId === targetId && current.edge === edge
            ? current
            : { targetId, edge }
        );
      },
      onDrop: ({ source, location }) => {
        setDraggingId(null);
        setDropIndicator(null);
        if (!isWebsiteOrderDragData(source.data)) return;
        const sourceId = source.data.id;
        const target = location.current.dropTargets[0];
        if (!target || !isWebsiteOrderDropData(target.data)) return;
        const targetId = target.data.id;
        const edge = getClosestVerticalEdge(
          target.element.getBoundingClientRect(),
          location.current.input.clientY
        );
        setWebsiteOrder((current) =>
          reorderWebsiteOrder(current, sourceId, targetId, edge)
        );
      },
    });
  }, [canReorderAny]);

  const orderedSources = useMemo(() => {
    const byId = new Map(sources.map((source) => [source.id, source]));
    const ordered: Pick<DownloadSource, "id" | "name">[] = [];
    for (const id of websiteOrder) {
      const source = byId.get(id);
      if (source) {
        ordered.push(source);
        byId.delete(id);
      }
    }
    ordered.push(...byId.values());
    return ordered;
  }, [sources, websiteOrder]);

  const orderChanged = !settingsValueEqual(websiteOrder, savedWebsiteOrder);

  const run = async (action: () => Promise<void>, success: string) => {
    setBusy(true);
    setMessage("");
    try {
      await action();
      setMessage(success);
    } catch (error) {
      setMessage(String(error));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="settings-source-websites">
      <h4>Source website profiles and cookies</h4>
      <p className="settings-source-websites__hint">
        Verify suggested website addresses before saving. Search addresses must
        use the same hostname and include {"{query}"}. The source website’s
        hostname is always approved. Add any other permitted hostnames
        explicitly; wildcards and automatic subdomain access are not allowed.
      </p>
      {message && (
        <p role="status" className="settings-source-websites__status">
          {message}
        </p>
      )}
      {profilesLoading && (
        <p role="status" className="settings-source-websites__hint">
          Loading website profiles…
        </p>
      )}
      {!profilesLoaded && !profilesLoading && (
        <div className="settings-source-websites__actions">
          <Button disabled={busy} onClick={() => void loadProfiles()}>
            Retry loading website profiles
          </Button>
        </div>
      )}
      <p className="settings-source-websites__hint">
        Website profiles work independently of download source feeds. Save a
        profile here to make it available as a Search on action in download
        options.
      </p>
      <div className="settings-source-websites__add-row">
        <TextField
          label="New website profile name"
          value={newName}
          disabled={busy}
          onChange={(event) => setNewName(event.target.value)}
        />
        <Button
          disabled={
            busy ||
            !profilesLoaded ||
            !newName.trim() ||
            newName.trim().length > 120
          }
          onClick={() => {
            const id = `website:${crypto.randomUUID()}`;
            const name = newName.trim();
            setSources((current) => [...current, { id, name }]);
            setProfiles((current) => ({
              ...current,
              [id]: { name, website: "", searchUrl: "" },
            }));
            setNewProfiles((current) => [...current, id]);
            setOpenProfiles((current) => ({ ...current, [id]: true }));
            setNewName("");
          }}
        >
          Add website profile
        </Button>
      </div>
      {profilesLoaded && orderedSources.length > 0 && (
        <section className="settings-source-websites__list-section">
          {(websiteOrder.length > 1 || orderChanged) && (
            <div className="settings-source-websites__order-bar">
              <p className="settings-source-websites__hint">
                Drag and drop saved profiles to reorder website search buttons
                in download options. Click a profile to edit its URLs and
                cookies.
              </p>
              <div className="settings-source-websites__actions">
                <Button
                  disabled={busy || !orderChanged}
                  onClick={() =>
                    void run(async () => {
                      if (
                        !(await confirm("save", [
                          "This changes the order of the website search buttons shown in download options.",
                        ]))
                      )
                        throw new Error("Search button order was not saved.");
                      await window.electron.updateUserPreferences({
                        sourceWebsiteSearchOrder: websiteOrder,
                      });
                      setSavedWebsiteOrder(websiteOrder);
                    }, "Search button order saved.")
                  }
                >
                  Save search order
                </Button>
                {orderChanged && (
                  <Button
                    theme="outline"
                    disabled={busy}
                    onClick={() => setWebsiteOrder(savedWebsiteOrder)}
                  >
                    Discard order changes
                  </Button>
                )}
              </div>
            </div>
          )}
          <ol className="settings-source-websites__profile-list">
            {orderedSources.map((source) => {
              const profile = profiles[source.id] ??
                suggestedWebsiteProfile(source.name) ?? {
                  website: "",
                  searchUrl: "",
                };
              const update = (patch: Partial<SourceWebsiteProfile>) => {
                setProfiles((prev) => ({
                  ...prev,
                  [source.id]: { ...profile, ...patch },
                }));
              };
              const isSaved = Boolean(savedProfiles[source.id]);
              const orderIndex = websiteOrder.indexOf(source.id);
              const canReorder = canReorderAny && isSaved && orderIndex >= 0;
              const displayName = profile.name?.trim() || source.name;

              return (
                <SortableWebsiteProfileCard
                  key={source.id}
                  id={source.id}
                  label={displayName}
                  orderIndex={orderIndex}
                  reorderableCount={websiteOrder.length}
                  canReorder={canReorder}
                  isSaved={isSaved}
                  isOpen={Boolean(openProfiles[source.id])}
                  isDragging={draggingId === source.id}
                  dropEdge={
                    dropIndicator?.targetId === source.id
                      ? dropIndicator.edge
                      : null
                  }
                  onToggleOpen={() =>
                    setOpenProfiles((current) => ({
                      ...current,
                      [source.id]: !current[source.id],
                    }))
                  }
                  onMove={(startIndex, finishIndex) =>
                    setWebsiteOrder((current) =>
                      moveOrderItem(current, startIndex, finishIndex)
                    )
                  }
                >
                  <TextField
                    label="Website profile name"
                    value={profile.name ?? source.name}
                    disabled={busy}
                    onChange={(event) => update({ name: event.target.value })}
                  />
                  <TextField
                    label="Website"
                    value={profile.website}
                    disabled={busy}
                    onChange={(event) =>
                      update({ website: event.target.value })
                    }
                  />
                  <TextField
                    label="Search address"
                    value={profile.searchUrl}
                    disabled={busy}
                    onChange={(event) =>
                      update({ searchUrl: event.target.value })
                    }
                  />
                  <label className="settings-context-advanced__domains">
                    Approved browsing domains (one exact hostname per line)
                    <textarea
                      rows={4}
                      disabled={busy}
                      placeholder="source.example&#10;www.source.example"
                      value={
                        domainDrafts[source.id] ??
                        (profile.approvedDomains ?? []).join("\n")
                      }
                      onChange={(event) => {
                        setDomainDrafts((prev) => ({
                          ...prev,
                          [source.id]: event.target.value,
                        }));
                      }}
                    />
                  </label>
                  <p className="settings-source-websites__hint">
                    Saving closes this source’s open browser windows and
                    discards their unsubmitted selections. Active and queued
                    downloads continue.
                  </p>
                  <div className="settings-source-websites__actions">
                    <Button
                      disabled={busy || !dirtySources.includes(source.id)}
                      onClick={() =>
                        void run(async () => {
                          if (
                            !(await confirm("save", [
                              `Website profile for ${source.name}. This changes permitted browsing domains and search addresses.`,
                              "All open source windows for this profile will close and their unsubmitted links will be discarded. Active downloads continue.",
                            ]))
                          )
                            throw new Error("Website profile was not saved.");
                          await window.electron.saveSourceWebsiteProfile(
                            source.id,
                            {
                              ...profile,
                              approvedDomains: (
                                domainDrafts[source.id] ??
                                (profile.approvedDomains ?? []).join("\n")
                              )
                                .split(/\r?\n/)
                                .map((domain) => domain.trim())
                                .filter(Boolean),
                            }
                          );
                          const [saved, preferences] = await Promise.all([
                            window.electron.getSourceWebsiteProfiles(),
                            window.electron.getUserPreferences(),
                          ]);
                          // Keep unsaved edits to other profiles intact.
                          setProfiles((current) => ({
                            ...current,
                            [source.id]: saved[source.id],
                          }));
                          setSavedProfiles(saved);
                          setNewProfiles((current) =>
                            current.filter((id) => id !== source.id)
                          );
                          setDomainDrafts((prev) => ({
                            ...prev,
                            [source.id]: (
                              saved[source.id].approvedDomains ?? []
                            ).join("\n"),
                          }));
                          setSavedWebsiteOrder(
                            orderSourceWebsiteProfiles(
                              saved,
                              preferences?.sourceWebsiteSearchOrder
                            )
                          );
                          setWebsiteOrder((current) =>
                            orderSourceWebsiteProfiles(saved, current)
                          );
                        }, "Website profile saved.")
                      }
                    >
                      Save website profile
                    </Button>
                    {dirtySources.includes(source.id) && (
                      <Button
                        theme="outline"
                        disabled={busy}
                        onClick={() =>
                          void run(async () => {
                            const saved =
                              await window.electron.getSourceWebsiteProfiles();
                            if (saved[source.id]) {
                              setProfiles((current) => ({
                                ...current,
                                [source.id]: saved[source.id],
                              }));
                              setSavedProfiles(saved);
                            } else if (newProfiles.includes(source.id)) {
                              setSources((current) =>
                                current.filter((item) => item.id !== source.id)
                              );
                              setProfiles((current) => {
                                const next = { ...current };
                                delete next[source.id];
                                return next;
                              });
                              setNewProfiles((current) =>
                                current.filter((id) => id !== source.id)
                              );
                            } else {
                              setProfiles((current) => {
                                const next = { ...current };
                                delete next[source.id];
                                return next;
                              });
                            }
                            setDomainDrafts((current) => {
                              const next = { ...current };
                              delete next[source.id];
                              return next;
                            });
                          }, "Website profile edits discarded.")
                        }
                      >
                        Discard profile edits
                      </Button>
                    )}
                    <Button
                      theme="outline"
                      disabled={busy}
                      onClick={() => setConfirmClear(source.id)}
                    >
                      Clear website data
                    </Button>
                  </div>
                  {confirmClear === source.id && (
                    <div className="local-edition__safety-warning" role="alert">
                      <p>
                        This closes all source browser windows, discards their
                        unsubmitted selections, and signs you out of this
                        website. Downloads are kept.
                      </p>
                      <div className="settings-source-websites__actions">
                        <Button
                          disabled={busy}
                          onClick={() =>
                            void run(async () => {
                              await window.electron.clearSourceWebsiteData(
                                source.id
                              );
                              setConfirmClear(null);
                            }, "Website cookies, cache, and logins cleared.")
                          }
                        >
                          Confirm clearing website data
                        </Button>
                        <Button
                          theme="outline"
                          disabled={busy}
                          onClick={() => setConfirmClear(null)}
                        >
                          Cancel
                        </Button>
                      </div>
                    </div>
                  )}
                </SortableWebsiteProfileCard>
              );
            })}
          </ol>
        </section>
      )}
    </div>
  );
}
