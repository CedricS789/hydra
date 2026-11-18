import {
  useSettingsConfirmation,
  useSettingsDraft,
  useSettingsFormGuard,
  useSettingsOperationGuard,
} from "@renderer/context/settings/settings-draft.context";
import {
  getDownloadOptionInteraction,
  type DownloadOptionInteraction,
} from "../../../../shared/download-option-interaction";
import { settingsValueEqual } from "../../../../shared/settings-changes";
import {
  orderSourceWebsiteProfiles,
  suggestedWebsiteProfile,
} from "../../../../shared/source-browser-policy";
import {
  allowsDirectTorrent,
  areAllDangerZonePreferencesDisabled,
  areAllDangerZonePreferencesEnabled,
  areAllSocialPreferencesDisabled,
  buildDisableAllDangerZonePreferencesPatch,
  buildDisableAllSocialPreferencesPatch,
  buildEnableAllDangerZonePreferencesPatch,
  buildSocialPreferenceUpdatePatch,
  DANGER_ZONE_ACTION_CONTROLS,
  DANGER_ZONE_MASTER_CONTROL,
  DIRECT_TORRENT_CONFIRMATION,
  filterExcludedLibraryGames,
  formatBulkLibraryRemovalConfirmation,
  getBulkLibraryRemovalBlockReason,
  getExcludedLibraryGameKey,
  isClassicsEnabled,
  isHydraAchievementPointsEnabled,
  isLibraryGameDownloading,
  isTransferGameEnabled,
  MANUAL_PLAYTIME_WARNING_CONTROLS,
  parseTrackerList,
  resolveDangerZonePreferences,
  resolveManualPlaytimeWarningPreferences,
  resolveSocialPreferences,
  SOCIAL_COMMUNITY_CONTROLS,
  SOCIAL_LEADERBOARD_METRIC_CONTROLS,
  SOCIAL_LEADERBOARD_SURFACE_CONTROLS,
  SOCIAL_NAVIGATION_CONTROLS,
} from "@shared";
import type {
  DownloadSource,
  ExcludedLibraryGame,
  GameShop,
  LibraryExclusionReason,
  LibraryGame,
  NetworkInterface,
} from "@types";
import type { SourceWebsiteProfile } from "../../../../types/source-browser.types";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useSearchParams } from "react-router-dom";
import {
  Button,
  Checkbox,
  DropdownSelect,
  GridFocusGroup,
  HorizontalFocusGroup,
  Input,
  Modal,
  VerticalFocusGroup,
} from "../../components";
import { ConfirmationModal } from "../../components/modals";
import {
  useBigPictureToast,
  useGameCollections,
  useLibrary,
  useUserPreferences,
} from "../../hooks";
import {
  ADVANCED_GATE_CHECKBOX_ID,
  ADVANCED_GATE_OPEN_ID,
  ADVANCED_SECTION_REGION_ID,
} from "./settings-navigation";
import { SettingsSection } from "./settings-section";
import "./advanced.scss";
import { SaveBackupsSettingsSection } from "./save-backups";
import { CompanionAppsSettingsSection } from "./companion-apps";
import { ControllerWakeSettingsSection } from "./controller-wake";
import { observeLatestSnapshot } from "../../helpers/observe-latest-snapshot";
import { ResetSettingsSection } from "./reset";

export function AdvancedSettingsSection({
  className,
}: Readonly<{ className?: string }>) {
  const { t } = useTranslation("settings");
  const draft = useSettingsDraft();
  const confirm = useSettingsConfirmation();
  const stagePreferences =
    draft?.stage ?? globalThis.window.electron.updateUserPreferences;
  const commitPreferences =
    draft?.commit ?? globalThis.window.electron.updateUserPreferences;
  const userPreferences = useUserPreferences();
  const { showSuccessToast, showErrorToast } = useBigPictureToast();
  const { library, updateLibrary } = useLibrary();
  const { loadCollections } = useGameCollections();

  const [searchParams] = useSearchParams();
  const requestedSection = searchParams.get("section");
  const requestedGame = searchParams.get("game");

  // Safety gate
  const [acknowledgedGate, setAcknowledgedGate] = useState(false);
  const [unlocked, setUnlocked] = useState(false);
  const [section, setSection] = useState<
    | "protection"
    | "features"
    | "dangerZone"
    | "media"
    | "companions"
    | "controller"
    | "websites"
    | "social"
    | "library"
    | "backups"
    | "resets"
    | null
  >(() => {
    if (requestedSection === "backups" || requestedGame) return "backups";
    if (
      requestedSection === "protection" ||
      requestedSection === "features" ||
      requestedSection === "dangerZone" ||
      requestedSection === "media" ||
      requestedSection === "companions" ||
      requestedSection === "controller" ||
      requestedSection === "websites" ||
      requestedSection === "social" ||
      requestedSection === "library"
    ) {
      return requestedSection;
    }
    return null;
  });
  const social = resolveSocialPreferences(userPreferences);
  const dangerZone = resolveDangerZonePreferences(userPreferences);
  const manualPlaytimeWarnings =
    resolveManualPlaytimeWarningPreferences(userPreferences);

  // Direct torrent & network
  const directTorrentEnabled = allowsDirectTorrent(userPreferences);
  const [torrentAck, setTorrentAck] = useState(false);
  const [torrentPhrase, setTorrentPhrase] = useState("");
  const [torrentWorking, setTorrentWorking] = useState(false);
  const [networkInterfaces, setNetworkInterfaces] = useState<
    NetworkInterface[]
  >([]);

  // Trackers
  const [manualTrackers, setManualTrackers] = useState("");
  const [trackerUrl, setTrackerUrl] = useState("");
  const [appendManualTrackers, setAppendManualTrackers] = useState(false);
  const [appendUrlTrackers, setAppendUrlTrackers] = useState(false);
  const [trackersSnapshot, setTrackersSnapshot] = useState("");

  // Source websites
  const [sources, setSources] = useState<Pick<DownloadSource, "id" | "name">[]>(
    []
  );
  const [profiles, setProfiles] = useState<
    Record<string, SourceWebsiteProfile>
  >({});
  const [savedProfiles, setSavedProfiles] = useState<
    Record<string, SourceWebsiteProfile>
  >({});
  const [domainDrafts, setDomainDrafts] = useState<Record<string, string>>({});
  const [newProfileName, setNewProfileName] = useState("");
  const [newProfileIds, setNewProfileIds] = useState<string[]>([]);
  const [websiteOrder, setWebsiteOrder] = useState<string[]>([]);
  const [savedWebsiteOrder, setSavedWebsiteOrder] = useState<string[]>([]);
  const [selectedProfileId, setSelectedProfileId] = useState("");
  const [confirmClearSiteId, setConfirmClearSiteId] = useState<string | null>(
    null
  );

  // Unified library management & exclusions
  const [libraryTab, setLibraryTab] = useState<"library" | "excluded">(
    "library"
  );
  const [runningIds, setRunningIds] = useState<Set<string>>(() => new Set());
  const [libraryFilterQuery, setLibraryFilterQuery] = useState("");
  const [selectedLibraryKeys, setSelectedLibraryKeys] = useState<Set<string>>(
    () => new Set()
  );
  const [bulkConfirmOpen, setBulkConfirmOpen] = useState(false);
  const [bulkAck, setBulkAck] = useState(false);
  const [bulkPhrase, setBulkPhrase] = useState("");

  const [excludedGames, setExcludedGames] = useState<ExcludedLibraryGame[]>([]);
  const [exclusionQuery, setExclusionQuery] = useState("");
  const [exclusionShopFilter, setExclusionShopFilter] = useState<
    GameShop | "all"
  >("all");
  const [confirmExclusionAction, setConfirmExclusionAction] = useState<
    "exclude-steam" | "clear-all" | null
  >(null);

  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  useSettingsOperationGuard("bp-advanced", busy || torrentWorking);

  const currentTrackerSnapshot = JSON.stringify([
    manualTrackers,
    trackerUrl,
    appendManualTrackers,
    appendUrlTrackers,
  ]);
  const trackersDirty =
    trackersSnapshot !== "" && currentTrackerSnapshot !== trackersSnapshot;
  useSettingsFormGuard(
    "bp-trackers",
    trackersDirty,
    "Torrent tracker settings"
  );

  const dirtyProfileIds = useMemo(
    () =>
      sources
        .filter((source) => {
          if (newProfileIds.includes(source.id)) return true;
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
    [domainDrafts, newProfileIds, profiles, savedProfiles, sources]
  );
  useSettingsFormGuard(
    "bp-source-profiles",
    dirtyProfileIds.length > 0,
    "Source website profiles"
  );

  useEffect(() => {
    globalThis.window.electron
      .getNetworkInterfaces()
      .then(setNetworkInterfaces)
      .catch(() => setNetworkInterfaces([]));
  }, []);

  useEffect(() => {
    if (!userPreferences || trackersSnapshot !== "") return;
    const manual = (userPreferences.globalTrackers ?? []).join("\n");
    const url = userPreferences.globalTrackersUrl ?? "";
    const am = userPreferences.appendGlobalTrackers ?? false;
    const au = userPreferences.appendGlobalTrackersUrl ?? false;
    setManualTrackers(manual);
    setTrackerUrl(url);
    setAppendManualTrackers(am);
    setAppendUrlTrackers(au);
    setTrackersSnapshot(JSON.stringify([manual, url, am, au]));
  }, [trackersSnapshot, userPreferences]);

  useEffect(() => {
    let active = true;
    void Promise.all([
      globalThis.window.electron
        .getDownloadSources()
        .catch(() => [] as DownloadSource[]),
      globalThis.window.electron
        .getSourceWebsiteProfiles()
        .catch(() => ({}) as Record<string, SourceWebsiteProfile>),
      globalThis.window.electron.getUserPreferences().catch(() => null),
    ]).then(([loadedSources, saved, prefs]) => {
      if (!active) return;
      const merged = new Map<string, Pick<DownloadSource, "id" | "name">>(
        loadedSources.map((item) => [item.id, item])
      );
      for (const [id, profile] of Object.entries(saved)) {
        if (!merged.has(id)) {
          let fallbackName = id;
          try {
            fallbackName = profile.name ?? new URL(profile.website).hostname;
          } catch {
            fallbackName = profile.name ?? id;
          }
          merged.set(id, { id, name: fallbackName });
        }
      }
      const nextSources = [...merged.values()];
      setSources(nextSources);
      setProfiles(saved);
      setSavedProfiles(saved);
      const order = orderSourceWebsiteProfiles(
        saved,
        prefs?.sourceWebsiteSearchOrder
      );
      setWebsiteOrder(order);
      setSavedWebsiteOrder(order);
      if (nextSources.length)
        setSelectedProfileId((current) => current || nextSources[0].id);
    });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    return observeLatestSnapshot(
      (listener) => globalThis.window.electron.onGamesRunning(listener),
      () => globalThis.window.electron.getGamesRunning(),
      (games) => setRunningIds(new Set(games.map((game) => game.id)))
    );
  }, []);

  useEffect(() => {
    let active = true;
    globalThis.window.electron
      .getExcludedLibraryGames()
      .then((entries) => {
        if (active) setExcludedGames(entries);
      })
      .catch(() => {});

    const unsubscribe =
      globalThis.window.electron.onExcludedLibraryGamesUpdated((entries) => {
        setExcludedGames(entries);
      });

    return () => {
      active = false;
      unsubscribe();
    };
  }, []);

  const networkInterfaceOptions = useMemo(
    () => [
      { value: "", label: t("network_interface_default") },
      ...networkInterfaces.map((iface) => ({
        value: iface.name,
        label: iface.name,
      })),
    ],
    [networkInterfaces, t]
  );

  const interactionOptions = useMemo(
    () => [
      { value: "native", label: "Native (click release opens download)" },
      { value: "menu", label: "Hydra action menu (extra confirmation step)" },
      {
        value: "website-only",
        label: "Website only (feed release cards disabled)",
      },
    ],
    []
  );

  const libraryEntries = useMemo(
    () =>
      library
        .filter((game) => !game.isDeleted)
        .sort((a, b) => a.title.localeCompare(b.title))
        .filter(
          (game) =>
            !libraryFilterQuery.trim() ||
            game.title
              .toLowerCase()
              .includes(libraryFilterQuery.trim().toLowerCase())
        ),
    [library, libraryFilterQuery]
  );

  const removableEntriesMap = useMemo(() => {
    const map = new Map<string, LibraryGame>();
    for (const game of libraryEntries) {
      const key = `${game.shop}:${game.objectId}`;
      const reason = getBulkLibraryRemovalBlockReason({
        isRunning: runningIds.has(game.id) || runningIds.has(key),
        isDownloading: isLibraryGameDownloading(game),
      });
      if (!reason) map.set(key, game);
    }
    return map;
  }, [libraryEntries, runningIds]);

  const selectedRemovableTargets = useMemo(
    () =>
      [...selectedLibraryKeys]
        .map((key) => removableEntriesMap.get(key))
        .filter((game): game is LibraryGame => Boolean(game))
        .map((game) => ({ shop: game.shop, objectId: game.objectId })),
    [removableEntriesMap, selectedLibraryKeys]
  );

  const expectedBulkPhrase = formatBulkLibraryRemovalConfirmation(
    selectedRemovableTargets.length
  );

  const handleToggleDirectTorrent = async (allow: boolean) => {
    setTorrentWorking(true);
    setError("");
    setMessage("");
    try {
      await commitPreferences(
        { allowDirectTorrent: allow, seedAfterDownloadComplete: false },
        allow ? torrentPhrase : undefined
      );
      setTorrentAck(false);
      setTorrentPhrase("");
      setMessage(t(allow ? "direct_torrents_on" : "direct_torrents_off"));
    } catch (caught) {
      const msg = caught instanceof Error ? caught.message : String(caught);
      setError(msg);
      showErrorToast(msg, { fallbackVisual: "settings" });
    } finally {
      setTorrentWorking(false);
    }
  };

  const handleSaveTrackers = async () => {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      if (
        !(await confirm("save", [
          "Change global torrent trackers. Tracker servers can see information about direct torrent activity.",
        ]))
      ) {
        return;
      }
      await globalThis.window.electron.saveGlobalTrackers(
        parseTrackerList(manualTrackers),
        trackerUrl || null,
        appendManualTrackers,
        appendUrlTrackers
      );
      setTrackersSnapshot(currentTrackerSnapshot);
      setMessage("Global trackers saved.");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setBusy(false);
    }
  };

  const activeSource = sources.find((s) => s.id === selectedProfileId);
  const activeProfile = activeSource
    ? (profiles[activeSource.id] ??
      suggestedWebsiteProfile(activeSource.name) ?? {
        website: "",
        searchUrl: "",
      })
    : null;

  const updateActiveProfile = (patch: Partial<SourceWebsiteProfile>) => {
    if (!activeSource || !activeProfile) return;
    setProfiles((prev) => ({
      ...prev,
      [activeSource.id]: { ...activeProfile, ...patch },
    }));
  };

  const handleSaveActiveProfile = async () => {
    if (!activeSource || !activeProfile) return;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      if (
        !(await confirm("save", [
          `Website profile for ${activeSource.name}. Permitted browsing domains and search URLs will update.`,
          "Open source windows for this profile will close.",
        ]))
      ) {
        return;
      }
      await globalThis.window.electron.saveSourceWebsiteProfile(
        activeSource.id,
        {
          ...activeProfile,
          approvedDomains: (
            domainDrafts[activeSource.id] ??
            (activeProfile.approvedDomains ?? []).join("\n")
          )
            .split(/\r?\n/)
            .map((domain) => domain.trim())
            .filter(Boolean),
        }
      );
      const saved = await globalThis.window.electron.getSourceWebsiteProfiles();
      setProfiles((current) => ({
        ...current,
        [activeSource.id]: saved[activeSource.id],
      }));
      setSavedProfiles(saved);
      setNewProfileIds((current) =>
        current.filter((id) => id !== activeSource.id)
      );
      setMessage("Website profile saved.");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setBusy(false);
    }
  };

  const handleConfirmBulkRemove = async () => {
    if (
      busy ||
      !selectedRemovableTargets.length ||
      !bulkAck ||
      bulkPhrase !== expectedBulkPhrase
    ) {
      return;
    }
    setBusy(true);
    setError("");
    try {
      const result =
        await globalThis.window.electron.bulkRemoveGamesFromLibrary(
          selectedRemovableTargets,
          bulkPhrase
        );
      for (const item of result.removed) {
        globalThis.window.dispatchEvent(
          new CustomEvent("hydra:game-removed-from-library", {
            detail: { shop: item.shop, objectId: item.objectId },
          })
        );
      }
      setBulkConfirmOpen(false);
      setBulkAck(false);
      setBulkPhrase("");
      setSelectedLibraryKeys(new Set());
      showSuccessToast(
        t("bulk_remove_success_toast", { count: result.removed.length }),
        { fallbackVisual: "settings" }
      );
    } catch (caught) {
      const msg = caught instanceof Error ? caught.message : String(caught);
      setError(msg);
      showErrorToast(msg, { fallbackVisual: "settings" });
    } finally {
      setBusy(false);
      await Promise.all([updateLibrary(), loadCollections()]).catch(() => {});
    }
  };

  const filteredExcludedGames = useMemo(
    () =>
      filterExcludedLibraryGames(excludedGames, {
        query: exclusionQuery,
        shop: exclusionShopFilter,
      }),
    [excludedGames, exclusionQuery, exclusionShopFilter]
  );

  const steamExclusionTargets = useMemo(() => {
    const synced = library.filter(
      (game) =>
        !game.isDeleted &&
        (game.hasActiveSteamImport ||
          game.source === "steam" ||
          (game.shop === "steam" && Boolean(game.remoteId)))
    );
    if (synced.length > 0) return synced;
    return library.filter((game) => !game.isDeleted && game.shop === "steam");
  }, [library]);

  const exclusionReasonLabel: Record<LibraryExclusionReason, string> = {
    removed: "Removed from library",
    manual: "Excluded manually",
    "steam-bulk": "Steam bulk exclude",
    bulk: "Bulk removed",
  };

  const handleRestoreOrUnexclude = async (
    entry: ExcludedLibraryGame,
    restoreToLibrary: boolean
  ) => {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      const result = await globalThis.window.electron.unexcludeLibraryGames(
        [{ shop: entry.shop, objectId: entry.objectId }],
        { restoreToLibrary }
      );
      setExcludedGames(result.entries);
      if (restoreToLibrary) {
        await Promise.all([updateLibrary(), loadCollections()]);
      }
      const msg = restoreToLibrary
        ? `Restored "${entry.title}" back into your library.`
        : `Removed "${entry.title}" from the exclusion list.`;
      setMessage(msg);
      showSuccessToast(msg, { fallbackVisual: "settings" });
    } catch (caught) {
      const msg = caught instanceof Error ? caught.message : String(caught);
      setError(msg);
      showErrorToast(msg, { fallbackVisual: "settings" });
    } finally {
      setBusy(false);
    }
  };

  const handleConfirmExclusionBulkAction = async () => {
    if (busy || !confirmExclusionAction) return;
    setBusy(true);
    setError("");
    try {
      if (confirmExclusionAction === "exclude-steam") {
        const result = await globalThis.window.electron.excludeLibraryGames(
          steamExclusionTargets.map((game) => ({
            shop: game.shop,
            objectId: game.objectId,
            title: game.title,
            source: game.source ?? null,
            iconUrl: game.iconUrl ?? null,
            libraryImageUrl: game.libraryImageUrl ?? game.coverImageUrl ?? null,
            reason: "steam-bulk",
          }))
        );
        setExcludedGames(result.entries);
        await Promise.all([updateLibrary(), loadCollections()]);
        const msg = `Excluded ${result.removedFromLibraryCount} Steam game(s) from your library and future syncs.`;
        setMessage(msg);
        showSuccessToast(msg, { fallbackVisual: "settings" });
      } else {
        const result =
          await globalThis.window.electron.clearExcludedLibraryGames();
        setExcludedGames([]);
        const msg = `Cleared ${result.removedCount} exclusion(s).`;
        setMessage(msg);
        showSuccessToast(msg, { fallbackVisual: "settings" });
      }
      setConfirmExclusionAction(null);
    } catch (caught) {
      const msg = caught instanceof Error ? caught.message : String(caught);
      setError(msg);
      showErrorToast(msg, { fallbackVisual: "settings" });
    } finally {
      setBusy(false);
    }
  };

  if (!unlocked) {
    return (
      <VerticalFocusGroup
        regionId={ADVANCED_SECTION_REGION_ID}
        className={className ? `bp-advanced ${className}` : "bp-advanced"}
      >
        <SettingsSection
          title={t("advanced_gate_title")}
          description={t("advanced_gate_description")}
        >
          <div className="bp-advanced__card">
            <Checkbox
              id="bp-advanced-gate-ack"
              focusId={ADVANCED_GATE_CHECKBOX_ID}
              label={t("advanced_gate_acknowledgement")}
              checked={acknowledgedGate}
              onChange={setAcknowledgedGate}
              block
            />
            <Button
              focusId={ADVANCED_GATE_OPEN_ID}
              variant="primary"
              disabled={!acknowledgedGate}
              onClick={() => setUnlocked(true)}
            >
              {t("advanced_gate_open")}
            </Button>
          </div>
        </SettingsSection>
      </VerticalFocusGroup>
    );
  }

  return (
    <VerticalFocusGroup
      regionId={ADVANCED_SECTION_REGION_ID}
      className={className ? `bp-advanced ${className}` : "bp-advanced"}
    >
      <div className="bp-advanced__toolbar">
        <p className="bp-advanced__hint">{t("advanced_unlocked_notice")}</p>
        <Button
          variant="secondary"
          onClick={() =>
            void draft?.guardNavigation(() => {
              setAcknowledgedGate(false);
              setUnlocked(false);
              setSection(null);
            })
          }
        >
          {t("advanced_lock")}
        </Button>
      </div>

      {section === null ? (
        <SettingsSection
          title="Advanced tools"
          description="Open a category to review or change its settings."
        >
          <GridFocusGroup
            regionId="bp-advanced-tools-actions"
            className="bp-advanced__actions"
          >
            <Button onClick={() => setSection("protection")}>
              Download protection & network
            </Button>
            <Button onClick={() => setSection("features")}>Features</Button>
            <Button onClick={() => setSection("dangerZone")}>
              Title Danger Zone
            </Button>
            <Button onClick={() => setSection("media")}>
              {t("advanced_media_title")}
            </Button>
            <Button onClick={() => setSection("companions")}>
              {t("companion_apps_title")}
            </Button>
            <Button onClick={() => setSection("controller")}>
              {t("advanced_controller_wake_title")}
            </Button>
            <Button onClick={() => setSection("websites")}>
              Source websites & cookies
            </Button>
            <Button onClick={() => setSection("social")}>
              Social & community visibility
            </Button>
            <Button onClick={() => setSection("library")}>
              Library management & exclusions
            </Button>
            <Button onClick={() => setSection("backups")}>
              Save backup configuration & recovery
            </Button>
            <Button onClick={() => setSection("resets")}>
              Reset and recovery
            </Button>
          </GridFocusGroup>
        </SettingsSection>
      ) : (
        <Button
          variant="secondary"
          onClick={() => void draft?.guardNavigation(() => setSection(null))}
        >
          Back to advanced tools
        </Button>
      )}

      {section === "backups" && <SaveBackupsSettingsSection advanced />}
      {section === "companions" && <CompanionAppsSettingsSection />}
      {section === "controller" && <ControllerWakeSettingsSection />}
      {section === "resets" && <ResetSettingsSection />}

      {error && (
        <p role="alert" className="bp-advanced__error">
          {error}
        </p>
      )}
      {message && (
        <p role="status" className="bp-advanced__notice">
          {message}
        </p>
      )}

      {section === "protection" && (
        <SettingsSection
          title={t("advanced_download_protection_title")}
          description={t("advanced_download_protection_description")}
        >
          <div className="bp-advanced__card">
            <p className="bp-advanced__status" role="status">
              {t(
                directTorrentEnabled
                  ? "direct_torrents_on"
                  : "direct_torrents_off"
              )}
            </p>
            <p className="bp-advanced__hint">
              {t("direct_torrents_description")}
            </p>

            {!directTorrentEnabled ? (
              <>
                <p className="bp-advanced__error">
                  {t("direct_torrents_warning")}
                </p>
                <Checkbox
                  id="bp-direct-torrent-ack"
                  label={t("direct_torrents_acknowledge")}
                  checked={torrentAck}
                  disabled={torrentWorking}
                  onChange={setTorrentAck}
                  block
                />
                <Input
                  label={t("direct_torrents_confirmation", {
                    phrase: DIRECT_TORRENT_CONFIRMATION,
                  })}
                  value={torrentPhrase}
                  disabled={torrentWorking}
                  onChange={(event) => setTorrentPhrase(event.target.value)}
                />
                <Button
                  variant="primary"
                  disabled={
                    torrentWorking ||
                    !torrentAck ||
                    torrentPhrase !== DIRECT_TORRENT_CONFIRMATION
                  }
                  onClick={() => void handleToggleDirectTorrent(true)}
                >
                  {t("direct_torrents_enable")}
                </Button>
              </>
            ) : (
              <>
                <Button
                  variant="danger"
                  disabled={torrentWorking}
                  onClick={() => void handleToggleDirectTorrent(false)}
                >
                  {t("direct_torrents_disable")}
                </Button>

                <DropdownSelect
                  label={t("network_interface")}
                  value={userPreferences?.torrentNetworkInterface ?? ""}
                  options={networkInterfaceOptions}
                  onValueChange={(value) =>
                    void stagePreferences({ torrentNetworkInterface: value })
                  }
                />

                <Checkbox
                  id="bp-advanced-seed"
                  label={t("seed_after_download_complete")}
                  checked={userPreferences?.seedAfterDownloadComplete ?? false}
                  onChange={(checked) =>
                    void stagePreferences({
                      seedAfterDownloadComplete: checked,
                    })
                  }
                  block
                />

                <Input
                  label={t("global_trackers")}
                  placeholder="udp://tracker.example:6969/announce"
                  value={manualTrackers}
                  disabled={busy}
                  onChange={(event) => setManualTrackers(event.target.value)}
                />
                <Input
                  label="Tracker list URL"
                  value={trackerUrl}
                  disabled={busy}
                  onChange={(event) => setTrackerUrl(event.target.value)}
                />
                <Checkbox
                  id="bp-trackers-append-manual"
                  label="Append manual trackers to downloads"
                  checked={appendManualTrackers}
                  disabled={busy}
                  onChange={setAppendManualTrackers}
                  block
                />
                <Checkbox
                  id="bp-trackers-append-url"
                  label="Append tracker list URL to downloads"
                  checked={appendUrlTrackers}
                  disabled={busy}
                  onChange={setAppendUrlTrackers}
                  block
                />
                <Button
                  variant="primary"
                  disabled={busy || !trackersDirty}
                  onClick={() => void handleSaveTrackers()}
                >
                  Save global trackers
                </Button>
              </>
            )}
          </div>
        </SettingsSection>
      )}

      {section === "features" && (
        <SettingsSection
          title={t("features")}
          description={t("advanced_features_description")}
        >
          <div className="bp-advanced__card">
            <Checkbox
              id="bp-advanced-classics"
              label={t("enable_classics")}
              checked={isClassicsEnabled(userPreferences)}
              onChange={(checked) =>
                void stagePreferences({ enableClassics: checked })
              }
              block
            />
            <Checkbox
              id="bp-advanced-transfer"
              label={t("enable_transfer_game")}
              checked={isTransferGameEnabled(userPreferences)}
              onChange={(checked) =>
                void stagePreferences({ enableTransferGame: checked })
              }
              block
            />
            <Checkbox
              id="bp-advanced-hydra-achievement-points"
              label={t("show_hydra_achievement_points")}
              checked={isHydraAchievementPointsEnabled(userPreferences)}
              onChange={(checked) =>
                void stagePreferences({ showHydraAchievementPoints: checked })
              }
              block
            />
            <p className="bp-advanced__hint">
              {t("show_hydra_achievement_points_hint")}
            </p>
          </div>
        </SettingsSection>
      )}

      {section === "dangerZone" && (
        <SettingsSection
          title="Title Danger Zone & destructive actions"
          description="Control access to the Danger Zone tab in title settings and individual destructive actions across title settings and game context menus."
        >
          <div className="bp-advanced__card">
            <GridFocusGroup
              regionId="bp-advanced-danger-zone-presets"
              className="bp-advanced__actions"
            >
              <Button
                variant="secondary"
                disabled={
                  busy || areAllDangerZonePreferencesDisabled(dangerZone)
                }
                onClick={() =>
                  void stagePreferences(
                    buildDisableAllDangerZonePreferencesPatch()
                  )
                }
              >
                Disable all
              </Button>
              <Button
                variant="secondary"
                disabled={
                  busy || areAllDangerZonePreferencesEnabled(dangerZone)
                }
                onClick={() =>
                  void stagePreferences(
                    buildEnableAllDangerZonePreferencesPatch()
                  )
                }
              >
                Enable all
              </Button>
            </GridFocusGroup>

            <Checkbox
              id="bp-danger-zone-master"
              label={DANGER_ZONE_MASTER_CONTROL.label}
              checked={dangerZone.enableDangerZone}
              disabled={busy}
              onChange={(checked) =>
                void stagePreferences({ enableDangerZone: checked })
              }
              block
            />
            {DANGER_ZONE_MASTER_CONTROL.description && (
              <p className="bp-advanced__hint">
                {DANGER_ZONE_MASTER_CONTROL.description}
              </p>
            )}

            <h4 className="bp-advanced__social-group-title">
              Individual actions
            </h4>
            <p className="bp-advanced__hint">
              Toggle each Danger Zone feature independently. Disabling Remove
              game files or Remove from library also hides them from game
              context menus. If every action below is turned off, the Danger
              Zone tab is hidden automatically.
            </p>
            {DANGER_ZONE_ACTION_CONTROLS.map((control) => (
              <Checkbox
                key={control.key}
                id={`bp-danger-zone-${control.key}`}
                label={control.label}
                checked={dangerZone[control.key]}
                disabled={busy}
                onChange={(checked) =>
                  void stagePreferences({ [control.key]: checked })
                }
                block
              />
            ))}

            <h4 className="bp-advanced__social-group-title">
              Manual playtime warnings
            </h4>
            <p className="bp-advanced__hint">
              Control whether the warning icon and warning text or tooltips
              appear when updating playtime manually and on games with manually
              updated playtime.
            </p>
            {MANUAL_PLAYTIME_WARNING_CONTROLS.map((control) => (
              <Checkbox
                key={control.key}
                id={`bp-manual-playtime-warning-${control.key}`}
                label={control.label}
                checked={manualPlaytimeWarnings[control.key]}
                disabled={busy}
                onChange={(checked) =>
                  void stagePreferences({ [control.key]: checked })
                }
                block
              />
            ))}
          </div>
        </SettingsSection>
      )}

      {section === "media" && (
        <SettingsSection
          title={t("advanced_media_title")}
          description={t("advanced_media_description")}
        >
          <div className="bp-advanced__card">
            <Checkbox
              id="bp-advanced-always-mute-trailers"
              label={t("always_mute_trailers_by_default")}
              checked={userPreferences?.alwaysMuteTrailersByDefault === true}
              onChange={(checked) =>
                void stagePreferences({ alwaysMuteTrailersByDefault: checked })
              }
              block
            />
            <p className="bp-advanced__hint">
              {t("always_mute_trailers_by_default_hint")}
            </p>
          </div>
        </SettingsSection>
      )}

      {section === "websites" && (
        <SettingsSection
          title="Source website profiles and cookies"
          description="Configure Search on websites, download option interaction, approved browsing domains, or clear saved website sessions."
        >
          <div className="bp-advanced__card">
            <Checkbox
              id="bp-advanced-source-browser"
              label="Enable source website browsing"
              checked={userPreferences?.enableSourceBrowser !== false}
              onChange={(checked) =>
                void stagePreferences({ enableSourceBrowser: checked })
              }
              block
            />
            <DropdownSelect
              label="Download option interaction"
              value={getDownloadOptionInteraction(userPreferences)}
              options={interactionOptions}
              onValueChange={(value) =>
                void stagePreferences({
                  downloadOptionInteraction: value as DownloadOptionInteraction,
                })
              }
            />
            {getDownloadOptionInteraction(userPreferences) === "website-only" &&
              userPreferences?.enableSourceBrowser === false && (
                <p role="alert" className="bp-advanced__error">
                  {t("website_only_browsing_disabled_warning")}
                </p>
              )}
            <GridFocusGroup
              regionId="bp-advanced-new-profile-row"
              className="bp-advanced__row"
            >
              <Input
                label="New website profile name"
                value={newProfileName}
                disabled={busy}
                onChange={(event) => setNewProfileName(event.target.value)}
              />
              <Button
                variant="secondary"
                disabled={busy || !newProfileName.trim()}
                onClick={() => {
                  const id = `website:${crypto.randomUUID()}`;
                  const name = newProfileName.trim();
                  setSources((curr) => [...curr, { id, name }]);
                  setProfiles((curr) => ({
                    ...curr,
                    [id]: { name, website: "", searchUrl: "" },
                  }));
                  setNewProfileIds((curr) => [...curr, id]);
                  setSelectedProfileId(id);
                  setNewProfileName("");
                }}
              >
                Add profile
              </Button>
            </GridFocusGroup>

            {sources.length > 0 && (
              <DropdownSelect
                label="Website profile"
                value={selectedProfileId}
                options={sources.map((s) => ({ value: s.id, label: s.name }))}
                onValueChange={setSelectedProfileId}
              />
            )}

            {activeSource && activeProfile && (
              <>
                <Input
                  label="Website profile name"
                  value={activeProfile.name ?? activeSource.name}
                  disabled={busy}
                  onChange={(event) =>
                    updateActiveProfile({ name: event.target.value })
                  }
                />
                <Input
                  label="Website"
                  value={activeProfile.website}
                  disabled={busy}
                  onChange={(event) =>
                    updateActiveProfile({ website: event.target.value })
                  }
                />
                <Input
                  label="Search address (includes {query})"
                  value={activeProfile.searchUrl}
                  disabled={busy}
                  onChange={(event) =>
                    updateActiveProfile({ searchUrl: event.target.value })
                  }
                />
                <label className="bp-advanced__textarea-label">
                  <span>Approved browsing domains (one hostname per line)</span>
                  <textarea
                    rows={3}
                    disabled={busy}
                    value={
                      domainDrafts[activeSource.id] ??
                      (activeProfile.approvedDomains ?? []).join("\n")
                    }
                    onChange={(event) =>
                      setDomainDrafts((prev) => ({
                        ...prev,
                        [activeSource.id]: event.target.value,
                      }))
                    }
                  />
                </label>

                <GridFocusGroup
                  regionId="bp-advanced-profile-actions"
                  className="bp-advanced__actions"
                >
                  <Button
                    variant="primary"
                    disabled={
                      busy || !dirtyProfileIds.includes(activeSource.id)
                    }
                    onClick={() => void handleSaveActiveProfile()}
                  >
                    Save website profile
                  </Button>
                  <Button
                    variant="danger"
                    disabled={busy}
                    onClick={() => setConfirmClearSiteId(activeSource.id)}
                  >
                    Clear website data
                  </Button>
                </GridFocusGroup>
              </>
            )}

            {websiteOrder.length > 1 && (
              <div className="bp-advanced__actions">
                <Button
                  variant="secondary"
                  disabled={
                    busy || settingsValueEqual(websiteOrder, savedWebsiteOrder)
                  }
                  onClick={() =>
                    void (async () => {
                      if (
                        !(await confirm("save", [
                          "Update the order of Search on buttons in download options.",
                        ]))
                      )
                        return;
                      await globalThis.window.electron.updateUserPreferences({
                        sourceWebsiteSearchOrder: websiteOrder,
                      });
                      setSavedWebsiteOrder(websiteOrder);
                      setMessage("Search button order saved.");
                    })().catch((caught) =>
                      setError(
                        caught instanceof Error
                          ? caught.message
                          : String(caught)
                      )
                    )
                  }
                >
                  Save search order
                </Button>
              </div>
            )}
          </div>
        </SettingsSection>
      )}

      {section === "social" && (
        <SettingsSection
          title="Social & community visibility"
          description="Control individual leaderboard surfaces, leaderboard categories (like Playtime vs. Achievements/Trophies), community stats, friends/chat, and sidebar navigation."
        >
          <div className="bp-advanced__card">
            <GridFocusGroup
              regionId="bp-advanced-social-presets"
              className="bp-advanced__actions"
            >
              <Button
                variant="secondary"
                disabled={busy || areAllSocialPreferencesDisabled(social)}
                onClick={() =>
                  void stagePreferences(buildDisableAllSocialPreferencesPatch())
                }
              >
                Disable all social features
              </Button>
              <Button
                variant="secondary"
                disabled={busy}
                onClick={() => setSection("resets")}
              >
                Open reset and recovery
              </Button>
            </GridFocusGroup>

            <h4 className="bp-advanced__social-group-title">
              Leaderboards & rankings
            </h4>
            {SOCIAL_LEADERBOARD_SURFACE_CONTROLS.map((control) => (
              <Checkbox
                key={control.key}
                id={`bp-social-${control.key}`}
                label={control.label}
                checked={social[control.key]}
                disabled={busy}
                onChange={(checked) =>
                  void stagePreferences(
                    buildSocialPreferenceUpdatePatch(userPreferences, {
                      [control.key]: checked,
                    })
                  )
                }
                block
              />
            ))}

            <h4 className="bp-advanced__social-group-title">
              Visible leaderboard categories
            </h4>
            <GridFocusGroup
              regionId="bp-advanced-social-categories"
              className="bp-advanced__social-categories"
            >
              {SOCIAL_LEADERBOARD_METRIC_CONTROLS.map((control) => (
                <Checkbox
                  key={control.key}
                  id={`bp-social-${control.key}`}
                  label={control.label}
                  checked={social[control.key]}
                  disabled={busy}
                  onChange={(checked) =>
                    void stagePreferences(
                      buildSocialPreferenceUpdatePatch(userPreferences, {
                        [control.key]: checked,
                      })
                    )
                  }
                  block
                />
              ))}
            </GridFocusGroup>

            <h4 className="bp-advanced__social-group-title">
              Community & game pages
            </h4>
            {SOCIAL_COMMUNITY_CONTROLS.map((control) => (
              <Checkbox
                key={control.key}
                id={`bp-social-${control.key}`}
                label={control.label}
                checked={social[control.key]}
                disabled={busy}
                onChange={(checked) =>
                  void stagePreferences(
                    buildSocialPreferenceUpdatePatch(userPreferences, {
                      [control.key]: checked,
                    })
                  )
                }
                block
              />
            ))}

            <h4 className="bp-advanced__social-group-title">
              Friends, chat & sidebar
            </h4>
            {SOCIAL_NAVIGATION_CONTROLS.map((control) => (
              <Checkbox
                key={control.key}
                id={`bp-social-${control.key}`}
                label={control.label}
                checked={social[control.key]}
                disabled={busy}
                onChange={(checked) =>
                  void stagePreferences(
                    buildSocialPreferenceUpdatePatch(userPreferences, {
                      [control.key]: checked,
                    })
                  )
                }
                block
              />
            ))}
          </div>
        </SettingsSection>
      )}

      {section === "library" && (
        <SettingsSection
          title="Library management & exclusions"
          description="Remove titles from your library or restore excluded ones. Any game you remove is automatically excluded across Steam sync, Epic sync, installed-game scans, LaunchBox, and RetroArch importers until restored or manually added again."
        >
          <div className="bp-advanced__card">
            <GridFocusGroup
              regionId="bp-library-management-tabs"
              className="bp-advanced__actions"
            >
              <Button
                variant={libraryTab === "library" ? "primary" : "secondary"}
                onClick={() => setLibraryTab("library")}
              >
                {`In library (${libraryEntries.length})`}
              </Button>
              <Button
                variant={libraryTab === "excluded" ? "primary" : "secondary"}
                onClick={() => setLibraryTab("excluded")}
              >
                {`Excluded (${excludedGames.length})`}
              </Button>
            </GridFocusGroup>

            {libraryTab === "library" ? (
              <>
                <Input
                  label="Search library titles"
                  placeholder="Filter library entries..."
                  value={libraryFilterQuery}
                  onChange={(event) =>
                    setLibraryFilterQuery(event.target.value)
                  }
                />

                <div className="bp-advanced__library-list">
                  {libraryEntries.map((game) => {
                    const key = `${game.shop}:${game.objectId}`;
                    const reason = getBulkLibraryRemovalBlockReason({
                      isRunning: runningIds.has(game.id) || runningIds.has(key),
                      isDownloading: isLibraryGameDownloading(game),
                    });
                    return (
                      <Checkbox
                        key={key}
                        id={`bp-bulk-remove-${key}`}
                        label={`${game.title} (${game.shop})${reason ? ` — ${reason}` : ""}`}
                        checked={selectedLibraryKeys.has(key)}
                        disabled={Boolean(reason) || busy}
                        onChange={(checked) =>
                          setSelectedLibraryKeys((prev) => {
                            const next = new Set(prev);
                            if (checked) next.add(key);
                            else next.delete(key);
                            return next;
                          })
                        }
                        block
                      />
                    );
                  })}
                </div>

                <GridFocusGroup
                  regionId="bp-library-management-actions"
                  className="bp-advanced__actions"
                >
                  <Button
                    variant="danger"
                    disabled={busy || selectedRemovableTargets.length === 0}
                    onClick={() => {
                      setBulkAck(false);
                      setBulkPhrase("");
                      setBulkConfirmOpen(true);
                    }}
                  >
                    {`Remove & exclude (${selectedRemovableTargets.length})`}
                  </Button>
                  {steamExclusionTargets.length > 0 && (
                    <Button
                      variant="secondary"
                      disabled={busy}
                      onClick={() => setConfirmExclusionAction("exclude-steam")}
                    >
                      {`Exclude all Steam (${steamExclusionTargets.length})`}
                    </Button>
                  )}
                </GridFocusGroup>
              </>
            ) : (
              <>
                <GridFocusGroup
                  regionId="bp-advanced-exclusions-filters"
                  className="bp-advanced__row"
                >
                  <Input
                    label="Search excluded titles"
                    placeholder="Filter by title or shop..."
                    value={exclusionQuery}
                    disabled={busy}
                    onChange={(event) => setExclusionQuery(event.target.value)}
                  />
                  <DropdownSelect
                    label="Shop filter"
                    value={exclusionShopFilter}
                    options={[
                      { value: "all", label: `All (${excludedGames.length})` },
                      { value: "steam", label: "Steam" },
                      { value: "epic", label: "Epic" },
                      { value: "launchbox", label: "LaunchBox" },
                      { value: "custom", label: "Custom" },
                    ]}
                    onValueChange={(value) =>
                      setExclusionShopFilter(value as GameShop | "all")
                    }
                  />
                </GridFocusGroup>

                <HorizontalFocusGroup
                  regionId="bp-exclusions-quick-actions"
                  className="bp-advanced__actions"
                >
                  <Button
                    variant="danger"
                    disabled={busy || excludedGames.length === 0}
                    onClick={() => setConfirmExclusionAction("clear-all")}
                  >
                    {`Clear all exclusions (${excludedGames.length})`}
                  </Button>
                </HorizontalFocusGroup>

                <div className="bp-advanced__library-list">
                  {filteredExcludedGames.length === 0 ? (
                    <p className="bp-advanced__hint">
                      {excludedGames.length === 0
                        ? "No excluded games yet. Any title removed from your library is automatically added here so syncs and importers do not bring it back."
                        : "No excluded titles match this search or shop filter."}
                    </p>
                  ) : (
                    filteredExcludedGames.map((entry) => {
                      const key = getExcludedLibraryGameKey(
                        entry.shop,
                        entry.objectId
                      );
                      return (
                        <div key={key} className="bp-advanced__exclusion-row">
                          <div className="bp-advanced__exclusion-meta">
                            <strong>{entry.title}</strong>
                            <span>
                              {`${entry.shop}${
                                entry.reason
                                  ? ` • ${exclusionReasonLabel[entry.reason]}`
                                  : ""
                              }`}
                            </span>
                          </div>
                          <HorizontalFocusGroup
                            regionId={`bp-exclusion-row-${key}`}
                            className="bp-advanced__actions"
                          >
                            <Button
                              variant="secondary"
                              disabled={busy}
                              onClick={() =>
                                void handleRestoreOrUnexclude(entry, true)
                              }
                            >
                              Restore
                            </Button>
                            <Button
                              variant="secondary"
                              disabled={busy}
                              onClick={() =>
                                void handleRestoreOrUnexclude(entry, false)
                              }
                            >
                              Un-exclude
                            </Button>
                          </HorizontalFocusGroup>
                        </div>
                      );
                    })
                  )}
                </div>
              </>
            )}
          </div>
        </SettingsSection>
      )}

      <ConfirmationModal
        visible={confirmExclusionAction !== null}
        title={
          confirmExclusionAction === "exclude-steam"
            ? "Exclude all Steam games?"
            : "Clear all library exclusions?"
        }
        description={
          confirmExclusionAction === "exclude-steam"
            ? `This will remove ${steamExclusionTargets.length} Steam game(s) from your library and prevent Steam sync from re-adding them.`
            : `This will clear all ${excludedGames.length} excluded entries. Future syncs or scans may re-add them.`
        }
        confirmLabel={
          confirmExclusionAction === "exclude-steam"
            ? "Exclude Steam games"
            : "Clear exclusions"
        }
        danger
        onClose={() => {
          if (!busy) setConfirmExclusionAction(null);
        }}
        onConfirm={() => void handleConfirmExclusionBulkAction()}
      />

      <ConfirmationModal
        visible={confirmClearSiteId !== null}
        title="Clear website data?"
        description="This closes open source windows for this website and clears saved cookies and logins."
        confirmLabel="Clear website data"
        danger
        loading={busy}
        onClose={() => setConfirmClearSiteId(null)}
        onConfirm={async () => {
          const siteId = confirmClearSiteId;
          if (!siteId || busy) return;
          setBusy(true);
          setError("");
          try {
            await globalThis.window.electron.clearSourceWebsiteData(siteId);
            setMessage("Website data cleared.");
            setConfirmClearSiteId(null);
          } catch (caught) {
            setError(caught instanceof Error ? caught.message : String(caught));
            setConfirmClearSiteId(null);
          } finally {
            setBusy(false);
          }
        }}
      />

      <Modal
        visible={bulkConfirmOpen}
        title={t("bulk_remove_title")}
        description={t("bulk_remove_description")}
        onClose={() => {
          if (!busy) setBulkConfirmOpen(false);
        }}
        backdropClassName="bp-advanced__modal-backdrop"
      >
        <div className="bp-advanced__modal-body">
          <Checkbox
            id="bp-bulk-remove-ack"
            label={t("bulk_remove_acknowledge", {
              count: selectedRemovableTargets.length,
            })}
            checked={bulkAck}
            onChange={setBulkAck}
            block
          />
          <Input
            label={t("bulk_remove_type_phrase", { phrase: expectedBulkPhrase })}
            value={bulkPhrase}
            onChange={(event) => setBulkPhrase(event.target.value)}
          />
          <HorizontalFocusGroup
            regionId="bp-bulk-remove-modal-actions"
            className="bp-advanced__actions"
          >
            <Button
              variant="secondary"
              disabled={busy}
              onClick={() => setBulkConfirmOpen(false)}
            >
              {t("cancel", { ns: "modal" })}
            </Button>
            <Button
              variant="danger"
              disabled={busy || !bulkAck || bulkPhrase !== expectedBulkPhrase}
              onClick={() => void handleConfirmBulkRemove()}
            >
              {t("bulk_remove_confirm")}
            </Button>
          </HorizontalFocusGroup>
        </div>
      </Modal>
    </VerticalFocusGroup>
  );
}
