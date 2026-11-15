import { useSettingsOperationGuard } from "@renderer/context/settings/settings-draft.context";
import { useEffect, useState } from "react";
import { useSettingsFormGuard } from "@renderer/context/settings/settings-draft.context";
import { Button, TextField } from "@renderer/components";
import type { DownloadSource } from "@types";
import type { SourceWebsiteProfile } from "../../../../types/source-browser.types";
import { suggestedWebsiteProfile } from "../../../../shared/source-browser-policy";

export function SettingsSourceWebsites() {
  const [sources, setSources] = useState<Pick<DownloadSource, "id" | "name">[]>(
    []
  );
  const [newName, setNewName] = useState("");
  const [profiles, setProfiles] = useState<
    Record<string, SourceWebsiteProfile>
  >({});
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  useSettingsOperationGuard("settings-source-websites", busy);
  const [confirmClear, setConfirmClear] = useState<string | null>(null);
  const [domainDrafts, setDomainDrafts] = useState<Record<string, string>>({});
  const [dirtySources, setDirtySources] = useState<string[]>([]);
  useSettingsFormGuard(
    "source-profiles",
    dirtySources.length > 0,
    "Source website profiles"
  );
  useEffect(() => {
    let active = true;
    void Promise.all([
      window.electron.getDownloadSources(),
      window.electron.getSourceWebsiteProfiles(),
    ])
      .then(([items, saved]) => {
        if (active) {
          setSources([
            ...items,
            ...Object.entries(saved)
              .filter(([id]) => !items.some((item) => item.id === id))
              .map(([id, profile]) => ({
                id,
                name: profile.name ?? new URL(profile.website).hostname,
              })),
          ]);
          setProfiles(saved);
        }
      })
      .catch((error) => {
        if (active) setMessage(String(error));
      });
    return () => {
      active = false;
    };
  }, []);
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
        <p>
          Website profiles work independently of download source feeds. Save a
          profile here to make it available in Search source websites.
        </p>
        <TextField
          label="New website profile name"
          value={newName}
          disabled={busy}
          onChange={(event) => setNewName(event.target.value)}
        />
        <Button
          disabled={busy || !newName.trim() || newName.trim().length > 120}
          onClick={() => {
            const id = `website:${crypto.randomUUID()}`;
            const name = newName.trim();
            setSources((current) => [...current, { id, name }]);
            setProfiles((current) => ({
              ...current,
              [id]: { name, website: "", searchUrl: "" },
            }));
            setDirtySources((current) => [...current, id]);
            setNewName("");
          }}
        >
          Add website profile
        </Button>
        {sources.map((source) => {
          const profile = profiles[source.id] ??
            suggestedWebsiteProfile(source.name) ?? {
              website: "",
              searchUrl: "",
            };
          const update = (patch: Partial<SourceWebsiteProfile>) => {
            setDirtySources((current) => [...new Set([...current, source.id])]);
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
                  onChange={(event) => update({ website: event.target.value })}
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
                      setDirtySources((current) => [
                        ...new Set([...current, source.id]),
                      ]);
                      setDomainDrafts((prev) => ({
                        ...prev,
                        [source.id]: event.target.value,
                      }));
                    }}
                  />
                </label>
                <p>
                  Saving closes this source’s open browser windows and discards
                  their unsubmitted selections. Active and queued downloads
                  continue.
                </p>
                <Button
                  disabled={busy}
                  onClick={() =>
                    void run(async () => {
                      if (
                        !(await window.electron.confirmSettingsChanges("save", [
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
                      setDirtySources((current) =>
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
                        if (saved[source.id])
                          setProfiles((current) => ({
                            ...current,
                            [source.id]: saved[source.id],
                          }));
                        else
                          setSources((current) =>
                            current.filter((item) => item.id !== source.id)
                          );
                        setDomainDrafts((current) => {
                          const next = { ...current };
                          delete next[source.id];
                          return next;
                        });
                        setDirtySources((current) =>
                          current.filter((id) => id !== source.id)
                        );
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
                      unsubmitted selections, and signs you out of this website.
                      Downloads are kept.
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
