import { useEffect, useMemo, useState } from "react";
import { changeLanguage } from "i18next";
import { orderBy } from "lodash-es";
import {
  CheckCircleIcon,
  DownloadIcon,
  ShieldCheckIcon,
  SyncIcon,
} from "@primer/octicons-react";
import languageResources from "@locales";
import type {
  DownloadSource,
  LudusaviLocalSettings,
  UserPreferences,
} from "@types";
import type { SourceWebsiteProfile } from "../../../../types/source-browser.types";
import {
  prepareDefaultDownloadPathSync,
  replaceSavedDownloadDirectoryAndSetDefault,
} from "@shared";
import { suggestedWebsiteProfile } from "../../../../shared/source-browser-policy";
import {
  Button,
  CheckboxField,
  Modal,
  SelectField,
  TextField,
} from "@renderer/components";
import "./getting-started-guide.scss";

interface RecommendedSource {
  key: "steamrip" | "fitgirl" | "dodi";
  name: string;
  url: string;
  hostname: string;
  description: string;
}

const RECOMMENDED_SOURCES: RecommendedSource[] = [
  {
    key: "steamrip",
    name: "SteamRIP",
    url: "https://hydralinks.cloud/sources/steamrip.json",
    hostname: "steamrip.com",
    description:
      "Pre-installed game releases with direct hoster links (Gofile, Pixeldrain, etc.).",
  },
  {
    key: "fitgirl",
    name: "FitGirl",
    url: "https://hydralinks.cloud/sources/fitgirl.json",
    hostname: "fitgirl-repacks.site",
    description:
      "Compact compressed repacks with broad coverage and release notes.",
  },
  {
    key: "dodi",
    name: "DODI",
    url: "https://hydralinks.cloud/sources/dodi.json",
    hostname: "dodi-repacks.site",
    description: "Fast-installing repacks and alternative game builds.",
  },
];

const STEP_LABELS = ["Welcome", "Sources", "Settings", "Ready"] as const;

export function GettingStartedGuide({
  visible,
  onClose,
}: {
  visible: boolean;
  onClose: () => void;
}) {
  const [step, setStep] = useState(0);
  const [selectedSources, setSelectedSources] = useState<string[]>(
    RECOMMENDED_SOURCES.map((source) => source.key)
  );
  const [installCatalogFeeds, setInstallCatalogFeeds] = useState(true);
  const [installWebsiteSearch, setInstallWebsiteSearch] = useState(true);

  const [existingSources, setExistingSources] = useState<DownloadSource[]>([]);
  const [existingProfiles, setExistingProfiles] = useState<
    Record<string, SourceWebsiteProfile>
  >({});

  const [preferences, setPreferences] = useState<UserPreferences | null>(null);
  const [defaultDownloadsPath, setDefaultDownloadsPath] = useState("");
  const [downloadsPath, setDownloadsPath] = useState("");
  const [language, setLanguage] = useState("en");
  const [hideToTrayOnGameStart, setHideToTrayOnGameStart] = useState(false);
  const [extractFilesByDefault, setExtractFilesByDefault] = useState(true);
  const [downloadNotificationsEnabled, setDownloadNotificationsEnabled] =
    useState(false);

  const [ludusaviSettings, setLudusaviSettings] =
    useState<LudusaviLocalSettings | null>(null);
  const [initialLudusaviSettings, setInitialLudusaviSettings] =
    useState<LudusaviLocalSettings | null>(null);

  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{
    tone: "info" | "error";
    text: string;
  } | null>(null);

  const languageOptions = useMemo(
    () =>
      orderBy(
        Object.entries(languageResources).map(([code, value]) => ({
          key: code,
          value: code,
          label: value.language_name,
        })),
        ["label"],
        "asc"
      ),
    []
  );

  useEffect(() => {
    if (!visible) return;
    let active = true;
    setStep(0);
    setMessage(null);

    void Promise.allSettled([
      window.electron.getDownloadSources(),
      window.electron.getSourceWebsiteProfiles(),
      window.electron.getUserPreferences(),
      window.electron.getDefaultDownloadsPath(),
      window.electron.getLudusaviLocalState(),
    ]).then(([sourcesRes, profilesRes, prefsRes, pathRes, ludusaviRes]) => {
      if (!active) return;

      if (sourcesRes.status === "fulfilled") {
        setExistingSources(sourcesRes.value);
      }
      if (profilesRes.status === "fulfilled") {
        setExistingProfiles(profilesRes.value);
      }

      const fallbackPath = pathRes.status === "fulfilled" ? pathRes.value : "";
      setDefaultDownloadsPath(fallbackPath);

      if (prefsRes.status === "fulfilled") {
        const prefs = prefsRes.value;
        setPreferences(prefs);
        setDownloadsPath(prefs?.downloadsPath || fallbackPath);
        const languageKeys = Object.keys(languageResources);
        setLanguage(
          languageKeys.find((code) => code === prefs?.language) ?? "en"
        );
        setHideToTrayOnGameStart(Boolean(prefs?.hideToTrayOnGameStart));
        setExtractFilesByDefault(prefs?.extractFilesByDefault !== false);
        setDownloadNotificationsEnabled(
          Boolean(prefs?.downloadNotificationsEnabled)
        );
      } else {
        setDownloadsPath(fallbackPath);
      }

      if (ludusaviRes.status === "fulfilled") {
        setLudusaviSettings(ludusaviRes.value.settings);
        setInitialLudusaviSettings(ludusaviRes.value.settings);
      }
    });

    return () => {
      active = false;
    };
  }, [visible]);

  const installedFeedUrls = useMemo(
    () => new Set(existingSources.map((source) => source.url)),
    [existingSources]
  );

  const installedWebsiteHosts = useMemo(() => {
    const hosts = new Set<string>();
    for (const profile of Object.values(existingProfiles)) {
      try {
        hosts.add(new URL(profile.website).hostname.toLowerCase());
      } catch {
        /* Ignore malformed URL. */
      }
    }
    return hosts;
  }, [existingProfiles]);

  const hasPendingSourceInstalls = useMemo(() => {
    return RECOMMENDED_SOURCES.some((source) => {
      if (!selectedSources.includes(source.key)) return false;
      const needsFeed =
        installCatalogFeeds && !installedFeedUrls.has(source.url);
      const needsProfile =
        installWebsiteSearch && !installedWebsiteHosts.has(source.hostname);
      return needsFeed || needsProfile;
    });
  }, [
    selectedSources,
    installCatalogFeeds,
    installWebsiteSearch,
    installedFeedUrls,
    installedWebsiteHosts,
  ]);

  const finish = async (openTutorials = false) => {
    setBusy(true);
    try {
      await window.electron.updateUserPreferences({
        firstRunGuideCompleted: true,
      });
      onClose();
      if (openTutorials) {
        window.dispatchEvent(
          new CustomEvent("hydra:open-interactive-tutorial")
        );
      }
    } catch (error) {
      setMessage({
        tone: "error",
        text: `Could not save setup completion: ${String(error)}`,
      });
    } finally {
      setBusy(false);
    }
  };

  const installSelectedSources = async (): Promise<boolean> => {
    const chosen = RECOMMENDED_SOURCES.filter((source) =>
      selectedSources.includes(source.key)
    );
    if (!chosen.length || (!installCatalogFeeds && !installWebsiteSearch)) {
      setMessage({
        tone: "info",
        text: "Select at least one source and one integration option, or skip this step.",
      });
      return false;
    }

    setBusy(true);
    setMessage(null);
    const addedFeeds: string[] = [];
    const failedFeeds: string[] = [];
    const addedWebsites: string[] = [];
    const failedWebsites: string[] = [];

    try {
      let currentSources = existingSources;
      if (installCatalogFeeds) {
        const missingFeeds = chosen.filter(
          (source) => !installedFeedUrls.has(source.url)
        );
        for (const source of missingFeeds) {
          try {
            await window.electron.addDownloadSource(source.url);
            addedFeeds.push(source.name);
          } catch {
            failedFeeds.push(source.name);
          }
        }
        currentSources = await window.electron.getDownloadSources();
        setExistingSources(currentSources);
        if (addedFeeds.length > 0) {
          await window.electron.syncDownloadSources();
        }
      }

      if (installWebsiteSearch) {
        for (const source of chosen) {
          if (installedWebsiteHosts.has(source.hostname)) continue;
          const suggestion = suggestedWebsiteProfile(source.key);
          if (!suggestion) continue;
          const matchingFeed = currentSources.find(
            (item) =>
              item.url === source.url ||
              item.name.toLowerCase().includes(source.key)
          );
          const profileId = matchingFeed?.id ?? `website:${source.key}`;
          try {
            await window.electron.saveSourceWebsiteProfile(profileId, {
              name: source.name,
              ...suggestion,
            });
            addedWebsites.push(source.name);
          } catch {
            failedWebsites.push(source.name);
          }
        }
        setExistingProfiles(await window.electron.getSourceWebsiteProfiles());
      }

      const parts: string[] = [];
      if (addedFeeds.length)
        parts.push(`Catalog feeds added & synced: ${addedFeeds.join(", ")}.`);
      if (addedWebsites.length)
        parts.push(`"Search on" enabled: ${addedWebsites.join(", ")}.`);
      if (!parts.length && !failedFeeds.length && !failedWebsites.length) {
        parts.push("Selected sources are already configured.");
      }
      if (failedFeeds.length) {
        parts.push(
          `Could not download catalog feed for: ${failedFeeds.join(", ")} (you can retry later in Settings).`
        );
      }
      if (failedWebsites.length) {
        parts.push(
          `Could not enable website search for: ${failedWebsites.join(", ")}.`
        );
      }
      setMessage({
        tone: failedFeeds.length || failedWebsites.length ? "error" : "info",
        text: parts.join(" "),
      });
      return failedFeeds.length === 0 && failedWebsites.length === 0;
    } catch (error) {
      setMessage({
        tone: "error",
        text: `Source setup encountered an error: ${String(error)}`,
      });
      return false;
    } finally {
      setBusy(false);
    }
  };

  const handleChooseDownloadsPath = async () => {
    const result = await window.electron.showOpenDialog({
      defaultPath: downloadsPath || defaultDownloadsPath,
      properties: ["openDirectory", "createDirectory"],
    });
    const chosen = result.filePaths?.[0];
    if (chosen) setDownloadsPath(chosen);
  };

  const handleChooseBackupPath = async () => {
    if (!ludusaviSettings) return;
    const result = await window.electron.showOpenDialog({
      defaultPath: ludusaviSettings.destination,
      properties: ["openDirectory", "createDirectory"],
    });
    const chosen = result.filePaths?.[0];
    if (chosen) {
      setLudusaviSettings({ ...ludusaviSettings, destination: chosen });
    }
  };

  const handleLanguageChange = (nextLanguage: string) => {
    setLanguage(nextLanguage);
    void changeLanguage(nextLanguage);
  };

  const saveStepSettings = async (): Promise<boolean> => {
    setBusy(true);
    setMessage(null);
    try {
      const nextPrefs: Partial<UserPreferences> = {
        language,
        hideToTrayOnGameStart,
        extractFilesByDefault,
        downloadNotificationsEnabled,
      };

      if (downloadsPath && defaultDownloadsPath) {
        const prepared = prepareDefaultDownloadPathSync(
          preferences,
          downloadsPath,
          defaultDownloadsPath
        );
        if (
          prepared.type === "set-existing" ||
          prepared.type === "add-and-set"
        ) {
          Object.assign(nextPrefs, prepared.nextPreferences);
        } else if (prepared.type === "replace-required") {
          const replaced = replaceSavedDownloadDirectoryAndSetDefault(
            preferences,
            prepared.nextPath,
            prepared.recommendedReplacementPath,
            defaultDownloadsPath
          );
          Object.assign(nextPrefs, replaced.nextPreferences);
        }
      }

      await window.electron.updateUserPreferences(nextPrefs);
      const latestPrefs = await window.electron.getUserPreferences();
      setPreferences(latestPrefs);

      if (
        ludusaviSettings &&
        initialLudusaviSettings &&
        (ludusaviSettings.enabled !== initialLudusaviSettings.enabled ||
          ludusaviSettings.destination !== initialLudusaviSettings.destination)
      ) {
        const saved =
          await window.electron.saveLudusaviLocalSettings(ludusaviSettings);
        setLudusaviSettings(saved.settings);
        setInitialLudusaviSettings(saved.settings);
      }

      return true;
    } catch (error) {
      setMessage({
        tone: "error",
        text: `Could not save settings: ${String(error)}`,
      });
      return false;
    } finally {
      setBusy(false);
    }
  };

  const handlePrimaryNext = async () => {
    setMessage(null);
    if (step === 1 && hasPendingSourceInstalls) {
      await installSelectedSources();
      setStep(2);
      return;
    }
    if (step === 2) {
      const ok = await saveStepSettings();
      if (!ok) return;
      setStep(3);
      return;
    }
    if (step === STEP_LABELS.length - 1) {
      await finish();
      return;
    }
    setStep((current) => current + 1);
  };

  const toggleSource = (key: string) => {
    setSelectedSources((current) =>
      current.includes(key)
        ? current.filter((item) => item !== key)
        : [...current, key]
    );
  };

  const configuredFeedCount = RECOMMENDED_SOURCES.filter((s) =>
    installedFeedUrls.has(s.url)
  ).length;
  const configuredWebsiteCount = RECOMMENDED_SOURCES.filter((s) =>
    installedWebsiteHosts.has(s.hostname)
  ).length;

  return (
    <Modal
      visible={visible}
      title="Welcome & First-Time Setup"
      description="Configure sources, folders, and save protection in a few quick steps"
      onClose={() => void finish()}
      clickOutsideToClose={false}
      className="getting-started-guide__modal"
    >
      <div className="getting-started-guide">
        <nav
          className="getting-started-guide__steps"
          aria-label="Onboarding steps"
        >
          {STEP_LABELS.map((label, index) => {
            const active = index === step;
            const completed = index < step;
            return (
              <button
                key={label}
                type="button"
                className={`getting-started-guide__step ${active ? "is-active" : ""} ${completed ? "is-complete" : ""}`}
                disabled={busy}
                onClick={() => {
                  setMessage(null);
                  setStep(index);
                }}
              >
                <span className="getting-started-guide__step-index">
                  {index + 1}
                </span>
                <span className="getting-started-guide__step-label">
                  {label}
                </span>
              </button>
            );
          })}
        </nav>

        {step === 0 && (
          <div className="getting-started-guide__panel">
            <div className="getting-started-guide__hero">
              <span className="getting-started-guide__badge">
                Hydra + Ludusavi Integrated
              </span>
              <h2>Set up Hydra Ludusavi in under a minute</h2>
              <p>
                Hydra Ludusavi combines Hydra’s game library, playtime tracking,
                and achievements with automatic local save backups and safer
                download defaults.
              </p>
            </div>

            <div className="getting-started-guide__highlights">
              <div className="getting-started-guide__card">
                <DownloadIcon size={18} aria-hidden="true" />
                <div>
                  <strong>Recommended game sources</strong>
                  <p>
                    Install SteamRIP, FitGirl, and DODI catalog feeds and
                    website search buttons in one click.
                  </p>
                </div>
              </div>
              <div className="getting-started-guide__card">
                <SyncIcon size={18} aria-hidden="true" />
                <div>
                  <strong>Automatic local save backups</strong>
                  <p>
                    Bundled Ludusavi backs up your saves whenever a game exits,
                    never overwriting live saves automatically.
                  </p>
                </div>
              </div>
              <div className="getting-started-guide__card">
                <ShieldCheckIcon size={18} aria-hidden="true" />
                <div>
                  <strong>Direct torrents blocked by default</strong>
                  <p>
                    Peer-to-peer torrents stay disabled until unlocked; debrid
                    providers and supported HTTP hosters work immediately.
                  </p>
                </div>
              </div>
            </div>

            <div className="getting-started-guide__inline-field">
              <SelectField
                label="Display language"
                theme="dark"
                value={language}
                options={languageOptions}
                disabled={busy}
                onChange={(event) => handleLanguageChange(event.target.value)}
              />
            </div>
          </div>
        )}

        {step === 1 && (
          <div className="getting-started-guide__panel">
            <div className="getting-started-guide__section-intro">
              <h2>Install recommended game sources</h2>
              <p>
                Sources do not download games automatically—they populate
                Hydra’s <strong>Download options</strong> and add quick{" "}
                <strong>Search on</strong> website buttons. You can add,
                reorder, or remove them anytime in Settings.
              </p>
            </div>

            <div className="getting-started-guide__source-list">
              {RECOMMENDED_SOURCES.map((source) => {
                const isSelected = selectedSources.includes(source.key);
                const hasFeed = installedFeedUrls.has(source.url);
                const hasSearch = installedWebsiteHosts.has(source.hostname);
                return (
                  <div
                    key={source.key}
                    className={`getting-started-guide__source-card ${isSelected ? "is-selected" : ""}`}
                  >
                    <CheckboxField
                      checked={isSelected}
                      disabled={busy}
                      onChange={() => toggleSource(source.key)}
                      label={
                        <span className="getting-started-guide__source-body">
                          <span className="getting-started-guide__source-top">
                            <strong>{source.name}</strong>
                            <span className="getting-started-guide__host">
                              {source.hostname}
                            </span>
                            {(hasFeed || hasSearch) && (
                              <span className="getting-started-guide__pill">
                                {hasFeed && hasSearch
                                  ? "Installed"
                                  : hasFeed
                                    ? "Feed added"
                                    : "Search ready"}
                              </span>
                            )}
                          </span>
                          <span className="getting-started-guide__source-desc">
                            {source.description}
                          </span>
                        </span>
                      }
                    />
                  </div>
                );
              })}
            </div>

            <div className="getting-started-guide__options-box">
              <CheckboxField
                label="Add Hydra catalog feeds (shows releases directly in Download options)"
                checked={installCatalogFeeds}
                disabled={busy}
                onChange={() => setInstallCatalogFeeds((v) => !v)}
              />
              <CheckboxField
                label='Enable "Search on" website buttons (lets you browse the site when feeds lack a title)'
                checked={installWebsiteSearch}
                disabled={busy}
                onChange={() => setInstallWebsiteSearch((v) => !v)}
              />
              <div className="getting-started-guide__source-actions">
                <Button
                  theme="outline"
                  disabled={
                    busy ||
                    !hasPendingSourceInstalls ||
                    selectedSources.length === 0
                  }
                  onClick={() => void installSelectedSources()}
                >
                  {busy
                    ? "Installing sources…"
                    : hasPendingSourceInstalls
                      ? "Install selected now"
                      : "All selected sources installed"}
                </Button>
              </div>
            </div>
          </div>
        )}

        {step === 2 && (
          <div className="getting-started-guide__panel">
            <div className="getting-started-guide__section-intro">
              <h2>Choose your essential settings</h2>
              <p>
                Review where games and save backups are stored, plus a few
                quality-of-life defaults.
              </p>
            </div>

            <div className="getting-started-guide__settings-grid">
              <div className="getting-started-guide__subcard">
                <TextField
                  label="Default downloads folder"
                  theme="dark"
                  value={downloadsPath}
                  readOnly
                  rightContent={
                    <Button
                      theme="outline"
                      disabled={busy}
                      onClick={() => void handleChooseDownloadsPath()}
                    >
                      Browse
                    </Button>
                  }
                />
              </div>

              {ludusaviSettings && (
                <div className="getting-started-guide__subcard">
                  <CheckboxField
                    label="Back up game saves automatically when a game closes"
                    checked={ludusaviSettings.enabled}
                    disabled={busy}
                    onChange={(event) =>
                      setLudusaviSettings({
                        ...ludusaviSettings,
                        enabled: event.target.checked,
                      })
                    }
                  />
                  <TextField
                    label="Save backup destination folder"
                    theme="dark"
                    value={ludusaviSettings.destination}
                    hint="Tip: Choose a OneDrive folder, second drive, or NAS path so backups survive a disk failure."
                    disabled={busy}
                    onChange={(event) =>
                      setLudusaviSettings({
                        ...ludusaviSettings,
                        destination: event.target.value,
                      })
                    }
                    rightContent={
                      <Button
                        theme="outline"
                        disabled={busy}
                        onClick={() => void handleChooseBackupPath()}
                      >
                        Browse
                      </Button>
                    }
                  />
                </div>
              )}

              <div className="getting-started-guide__subcard">
                <CheckboxField
                  label="Minimize Hydra to the system tray when launching a game (recommended for exit backups)"
                  checked={hideToTrayOnGameStart}
                  disabled={busy}
                  onChange={() => setHideToTrayOnGameStart((v) => !v)}
                />
                <CheckboxField
                  label="Automatically extract downloaded ZIP/RAR/7z archives"
                  checked={extractFilesByDefault}
                  disabled={busy}
                  onChange={() => setExtractFilesByDefault((v) => !v)}
                />
                <CheckboxField
                  label="Notify when a download finishes"
                  checked={downloadNotificationsEnabled}
                  disabled={busy}
                  onChange={() => setDownloadNotificationsEnabled((v) => !v)}
                />
              </div>
            </div>
          </div>
        )}

        {step === 3 && (
          <div className="getting-started-guide__panel">
            <div className="getting-started-guide__hero">
              <CheckCircleIcon
                size={28}
                className="getting-started-guide__done-icon"
                aria-hidden="true"
              />
              <h2>You’re ready to start using Hydra Ludusavi</h2>
              <p>
                Here is a summary of your current setup. Everything can be
                adjusted later in Settings, and you can reopen this setup wizard
                or run the interactive tutorials anytime from{" "}
                <strong>Settings</strong>.
              </p>
            </div>

            <div className="getting-started-guide__summary">
              <div>
                <span>Sources configured</span>
                <strong>
                  {configuredFeedCount} catalog feed
                  {configuredFeedCount === 1 ? "" : "s"} ·{" "}
                  {configuredWebsiteCount} “Search on” site
                  {configuredWebsiteCount === 1 ? "" : "s"}
                </strong>
              </div>
              <div>
                <span>Downloads folder</span>
                <strong>
                  {downloadsPath || defaultDownloadsPath || "Default"}
                </strong>
              </div>
              <div>
                <span>Save backups</span>
                <strong>
                  {ludusaviSettings
                    ? `${ludusaviSettings.enabled ? "Automatic on game exit" : "Manual only"} · ${ludusaviSettings.destination}`
                    : "Configured in Settings → Save backups"}
                </strong>
              </div>
            </div>

            <div className="getting-started-guide__next-steps">
              <strong>Where to go next</strong>
              <ul>
                <li>
                  <strong>Discover existing PC saves:</strong> Open{" "}
                  <em>Settings → Save backups → Discover saved games</em> to
                  import games already installed on your PC.
                </li>
                <li>
                  <strong>Connect a Debrid provider (optional):</strong> Open{" "}
                  <em>Settings → Integrations</em> to link Real-Debrid, TorBox,
                  Premiumize, or AllDebrid.
                </li>
                <li>
                  <strong>Browse &amp; download:</strong> Open{" "}
                  <em>Catalogue</em> to add games, or use <em>Search on</em>{" "}
                  inside Download options.
                </li>
              </ul>
            </div>
          </div>
        )}

        {message && (
          <p
            className={`getting-started-guide__message ${message.tone === "error" ? "is-error" : ""}`}
            role={message.tone === "error" ? "alert" : "status"}
          >
            {message.text}
          </p>
        )}

        <div className="getting-started-guide__actions">
          <Button theme="outline" disabled={busy} onClick={() => void finish()}>
            Skip setup
          </Button>
          <div>
            {step > 0 && (
              <Button
                theme="outline"
                disabled={busy}
                onClick={() => {
                  setMessage(null);
                  setStep((value) => value - 1);
                }}
              >
                Back
              </Button>
            )}
            {step === 1 && hasPendingSourceInstalls && (
              <Button
                theme="outline"
                disabled={busy}
                onClick={() => {
                  setMessage(null);
                  setStep(2);
                }}
              >
                Continue without installing
              </Button>
            )}
            {step === STEP_LABELS.length - 1 && (
              <Button
                theme="outline"
                disabled={busy}
                onClick={() => void finish(true)}
              >
                Interactive tutorials
              </Button>
            )}
            <Button
              theme="primary"
              disabled={busy}
              onClick={() => void handlePrimaryNext()}
            >
              {busy
                ? "Working…"
                : step === 1 && hasPendingSourceInstalls
                  ? "Install & continue"
                  : step === 2
                    ? "Save & continue"
                    : step === STEP_LABELS.length - 1
                      ? "Finish setup"
                      : "Next"}
            </Button>
          </div>
        </div>
      </div>
    </Modal>
  );
}
