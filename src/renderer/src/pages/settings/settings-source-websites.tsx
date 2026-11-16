import {
  useSettingsOperationGuard,
  useSettingsConfirmation,
} from "@renderer/context/settings/settings-draft.context";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useSettingsFormGuard } from "@renderer/context/settings/settings-draft.context";
import { Button, TextField } from "@renderer/components";
import type { DownloadSource } from "@types";
import type { SourceWebsiteProfile } from "../../../../types/source-browser.types";
import {
  orderSourceWebsiteProfiles,
  suggestedWebsiteProfile,
} from "../../../../shared/source-browser-policy";
import { settingsValueEqual } from "../../../../shared/settings-changes";

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
    <details className="settings-context-advanced__menu">
      <summary>
        <span>Source website profiles and cookies</span>
        <small>
          Set website search addresses or clear a source’s saved website logins.
        </small>
      </summary>
      <div className="settings-context-advanced__menu-body">
        <p>
          Verify suggested website addresses before saving. Search addresses
          must use the same hostname and include {"{query}"}. The source
          website’s hostname is always approved. Add any other permitted
          hostnames explicitly; wildcards and automatic subdomain access are not
          allowed.
        </p>
        {message && <p role="status">{message}</p>}
        {profilesLoading && <p role="status">Loading website profiles…</p>}
        {!profilesLoaded && !profilesLoading && (
          <Button disabled={busy} onClick={() => void loadProfiles()}>
            Retry loading website profiles
          </Button>
        )}
        <p>
          Website profiles work independently of download source feeds. Save a
          profile here to make it available as a Search on action in download
          options.
        </p>
        {profilesLoaded && Object.keys(profiles).length > 0 && (
          <section className="settings-source-websites__order">
            <h4>Search button order</h4>
            <p>
              This controls the order of website search buttons in download
              options. It does not change Hydra feed results or their download
              order.
            </p>
            <ol>
              {websiteOrder.map((id, index) => (
                <li key={id}>
                  <span>
                    {profiles[id]?.name ??
                      sources.find((source) => source.id === id)?.name ??
                      id}
                  </span>
                  <Button
                    theme="outline"
                    disabled={busy || index === 0}
                    onClick={() =>
                      setWebsiteOrder((current) => {
                        const next = [...current];
                        [next[index - 1], next[index]] = [
                          next[index],
                          next[index - 1],
                        ];
                        return next;
                      })
                    }
                  >
                    Move up
                  </Button>
                  <Button
                    theme="outline"
                    disabled={busy || index === websiteOrder.length - 1}
                    onClick={() =>
                      setWebsiteOrder((current) => {
                        const next = [...current];
                        [next[index], next[index + 1]] = [
                          next[index + 1],
                          next[index],
                        ];
                        return next;
                      })
                    }
                  >
                    Move down
                  </Button>
                </li>
              ))}
            </ol>
            <Button
              disabled={
                busy || settingsValueEqual(websiteOrder, savedWebsiteOrder)
              }
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
            {!settingsValueEqual(websiteOrder, savedWebsiteOrder) && (
              <Button
                theme="outline"
                disabled={busy}
                onClick={() => setWebsiteOrder(savedWebsiteOrder)}
              >
                Discard order changes
              </Button>
            )}
          </section>
        )}
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
            setNewName("");
          }}
        >
          Add website profile
        </Button>
        {profilesLoaded &&
          sources.map((source) => {
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
            return (
              <details key={source.id}>
                <summary>{source.name}</summary>
                <div className="settings-context-advanced__menu-body">
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
                  <p>
                    Saving closes this source’s open browser windows and
                    discards their unsubmitted selections. Active and queued
                    downloads continue.
                  </p>
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
                        const saved =
                          await window.electron.getSourceWebsiteProfiles();
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
                  {confirmClear === source.id && (
                    <div role="alert">
                      <p>
                        This closes all source browser windows, discards their
                        unsubmitted selections, and signs you out of this
                        website. Downloads are kept.
                      </p>
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
                  )}
                </div>
              </details>
            );
          })}
      </div>
    </details>
  );
}
