import {
  useSettingsConfirmation,
  useSettingsFormGuard,
  useSettingsOperationGuard,
} from "@renderer/context/settings/settings-draft.context";
import { settingsValueEqual } from "../../../../shared/settings-changes";
import type {
  DetectedSaveGame,
  LudusaviGameSettings,
  LudusaviLocalSettings,
  SaveBackupVersion,
  SaveDiscoveryProgress,
  SaveOperationPreview,
  SaveSafetySnapshot,
} from "@types";
import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate, useSearchParams } from "react-router-dom";
import {
  Button,
  Checkbox,
  DropdownSelect,
  GridFocusGroup,
  Input,
  VerticalFocusGroup,
} from "../../components";
import { ConfirmationModal } from "../../components/modals";
import {
  useBigPictureToast,
  useDate,
  useLibrary,
  useLudusaviLocalState,
} from "../../hooks";
import { SettingsSection } from "./settings-section";
import {
  SAVE_BACKUPS_PRIMARY_BUTTON_ID,
  SAVE_BACKUPS_SECTION_REGION_ID,
} from "./settings-navigation";
import "./save-backups.scss";
import { useGamePathsDraft } from "../../hooks/use-game-paths-draft";
import { withGameBackupEnabled } from "../../helpers/backup-settings-draft";
import { BigPictureHydraConfigSection } from "./hydra-config-backup-section";

type SaveBackupsSubview =
  | "overview"
  | "discovery"
  | "restore"
  | "rules"
  | "config";
type DiscoveryStatusFilter = "all" | "unmatched" | "matched";

const emptyGameSettings: LudusaviGameSettings = {
  enabled: true,
  savePaths: [],
  trackingPaths: [],
};

const parsePathLines = (value: string) =>
  value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

export function SaveBackupsSettingsSection({
  className,
  advanced = false,
}: Readonly<{ className?: string; advanced?: boolean }>) {
  const { t } = useTranslation("ludusavi");
  const { formatDateTime, formatDistance } = useDate();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const confirm = useSettingsConfirmation();
  const { showErrorToast, showSuccessToast } = useBigPictureToast();
  const { updateLibrary } = useLibrary();
  const { state, error: stateError, refresh } = useLudusaviLocalState();

  const requestedGameKey = searchParams.get("game") ?? "";

  const [subview, setSubview] = useState<SaveBackupsSubview>(
    advanced && requestedGameKey ? "restore" : "overview"
  );
  const [selectedGameKey, setSelectedGameKey] = useState(requestedGameKey);
  const [overviewFilter, setOverviewFilter] = useState("");
  const [includeDisabledBulk, setIncludeDisabledBulk] = useState(false);
  const [includeHydraConfigBulk, setIncludeHydraConfigBulk] = useState(false);

  // Discovery state
  const [discoveryEntries, setDiscoveryEntries] = useState<DetectedSaveGame[]>(
    []
  );
  const [discoveryFilter, setDiscoveryFilter] =
    useState<DiscoveryStatusFilter>("all");
  const [discoveryQuery, setDiscoveryQuery] = useState("");
  const [scanning, setScanning] = useState(false);
  const [scanProgress, setScanProgress] = useState<SaveDiscoveryProgress>();
  const [discoveryNotice, setDiscoveryNotice] = useState("");

  // Restore / Versions state
  const [versions, setVersions] = useState<SaveBackupVersion[]>([]);
  const [selectedVersion, setSelectedVersion] = useState("");
  const [snapshots, setSnapshots] = useState<SaveSafetySnapshot[]>([]);
  const [selectedSnapshotId, setSelectedSnapshotId] = useState("");
  const [lastSafetySnapshot, setLastSafetySnapshot] = useState<{
    id: string;
    backup: string;
  } | null>(null);
  const [preview, setPreview] = useState<SaveOperationPreview | null>(null);
  const [restoreUnderstood, setRestoreUnderstood] = useState(false);

  // Editable rules state (destination / enable / retention / per-game paths)
  const [settings, setSettings] = useState<LudusaviLocalSettings>();
  const [savedSettings, setSavedSettings] = useState<LudusaviLocalSettings>();
  const [retentionAcknowledged, setRetentionAcknowledged] = useState(false);
  const [pathsAcknowledged, setPathsAcknowledged] = useState(false);

  const [working, setWorking] = useState(false);
  useSettingsOperationGuard("bp-save-backups", working);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [confirmClear, setConfirmClear] = useState(false);
  const generation = useRef(0);
  const appliedRequestedGame = useRef<string | null>(null);

  const settingsDirty = Boolean(
    settings && savedSettings && !settingsValueEqual(settings, savedSettings)
  );
  const selectedGameSettings =
    (selectedGameKey && settings?.games[selectedGameKey]) || emptyGameSettings;
  const {
    savePathsText,
    trackingPathsText,
    setSavePathsText,
    setTrackingPathsText,
    discardPaths,
  } = useGamePathsDraft(selectedGameKey, selectedGameSettings);
  const pathsDirty = Boolean(
    selectedGameKey &&
      settings &&
      (!settingsValueEqual(
        parsePathLines(savePathsText),
        selectedGameSettings.savePaths
      ) ||
        !settingsValueEqual(
          parsePathLines(trackingPathsText),
          selectedGameSettings.trackingPaths
        ))
  );
  useSettingsFormGuard(
    "bp-save-backups-rules",
    settingsDirty || pathsDirty,
    "Save backup configuration"
  );

  useEffect(() => {
    if (state && !settingsDirty) {
      setSettings(state.settings);
      setSavedSettings(state.settings);
    }
  }, [state, settingsDirty]);

  useEffect(() => {
    if (stateError) setError(stateError);
  }, [stateError]);

  useEffect(() => {
    if (!state?.games.length) {
      setSelectedGameKey("");
      return;
    }
    if (
      requestedGameKey &&
      appliedRequestedGame.current !== requestedGameKey &&
      state.games.some((game) => game.key === requestedGameKey)
    ) {
      setSelectedGameKey(requestedGameKey);
      appliedRequestedGame.current = requestedGameKey;
      return;
    }
    if (
      selectedGameKey &&
      !state.games.some((game) => game.key === selectedGameKey)
    ) {
      setSelectedGameKey(state.games.length === 1 ? state.games[0].key : "");
      return;
    }
    if (!selectedGameKey && state.games.length === 1) {
      setSelectedGameKey(state.games[0].key);
    }
  }, [requestedGameKey, selectedGameKey, state?.games]);

  useEffect(() => {
    generation.current += 1;
    setVersions([]);
    setSelectedVersion("");
    setSnapshots([]);
    setSelectedSnapshotId("");
    setLastSafetySnapshot(null);
    setPreview(null);
    setRestoreUnderstood(false);
  }, [selectedGameKey, settings?.destination]);

  useEffect(() => {
    if (!scanning) return;
    let mounted = true;
    const poll = async () => {
      try {
        const value =
          await globalThis.window.electron.getSaveDiscoveryProgress();
        if (mounted) setScanProgress(value);
      } catch {
        /* ignore transient progress polling errors */
      }
    };
    void poll();
    const timer = globalThis.window.setInterval(() => void poll(), 500);
    return () => {
      mounted = false;
      globalThis.window.clearInterval(timer);
    };
  }, [scanning]);

  const sortedGames = useMemo(
    () =>
      [...(state?.games ?? [])].sort((a, b) => a.title.localeCompare(b.title)),
    [state?.games]
  );

  const filteredGames = useMemo(() => {
    const query = overviewFilter.trim().toLowerCase();
    if (!query) return sortedGames;
    return sortedGames.filter((game) =>
      game.title.toLowerCase().includes(query)
    );
  }, [overviewFilter, sortedGames]);

  const isInLibrary = (entry: DetectedSaveGame) =>
    Boolean(
      (entry.matchedGameKey &&
        sortedGames.some((game) => game.key === entry.matchedGameKey)) ||
        entry.matchingGameKeys.some((key) =>
          sortedGames.some((game) => game.key === key)
        )
    );

  const unmatchedEntries = discoveryEntries.filter(
    (entry) => !isInLibrary(entry)
  );
  const matchedEntries = discoveryEntries.filter((entry) => isInLibrary(entry));
  const filteredDiscoveryEntries = discoveryEntries.filter((entry) => {
    if (
      discoveryQuery.trim() &&
      !entry.title.toLowerCase().includes(discoveryQuery.trim().toLowerCase())
    ) {
      return false;
    }
    if (discoveryFilter === "unmatched") return !isInLibrary(entry);
    if (discoveryFilter === "matched") return isInLibrary(entry);
    return true;
  });

  if (!state || !settings) {
    return (
      <div
        className={
          className ? `bp-save-backups ${className}` : "bp-save-backups"
        }
      >
        <SettingsSection title={t("title")} description={t("description")}>
          <p className="bp-save-backups__status" role="status">
            {error || t("loading")}
          </p>
        </SettingsSection>
      </div>
    );
  }

  const busy = working || state.busy || state.bulkProgress.running;
  const bulk = state.bulkProgress;
  const latestBackup = state.history.find(
    (result) => !result.operation || result.operation === "backup"
  );
  const retentionReduced =
    settings.fullRetention < state.settings.fullRetention ||
    (settings.differentialRetention ?? 0) <
      (state.settings.differentialRetention ?? 0);
  const canSaveRules =
    (!retentionReduced || retentionAcknowledged) &&
    (!pathsDirty || pathsAcknowledged) &&
    (settingsDirty || pathsDirty);

  const runTask = async (
    task: () => Promise<unknown>,
    successToastTitle?: string
  ) => {
    setWorking(true);
    setError("");
    setNotice("");
    try {
      await task();
      const latest = await refresh();
      if (!settingsDirty) {
        setSettings(latest.settings);
        setSavedSettings(latest.settings);
      }
      if (successToastTitle) {
        showSuccessToast(successToastTitle, { fallbackVisual: "settings" });
      }
    } catch (caught) {
      const msg = caught instanceof Error ? caught.message : String(caught);
      setError(msg);
      showErrorToast(t("status_failed"), {
        fallbackVisual: "settings",
        message: msg,
      });
    } finally {
      setWorking(false);
    }
  };

  const handleSaveRules = () =>
    void runTask(async () => {
      if (retentionReduced && !retentionAcknowledged) {
        throw new Error(t("retention_ack_required"));
      }
      if (pathsDirty && !pathsAcknowledged) {
        throw new Error(t("paths_ack_required"));
      }
      const current = await globalThis.window.electron.getLudusaviLocalState();
      if (!settingsValueEqual(current.settings, savedSettings)) {
        throw new Error(
          "Backup settings changed elsewhere. Discard edits and review current settings before trying again."
        );
      }
      const next: LudusaviLocalSettings = {
        ...settings,
        games: { ...settings.games },
      };
      if (pathsDirty && selectedGameKey) {
        next.games[selectedGameKey] = {
          ...(next.games[selectedGameKey] ?? emptyGameSettings),
          savePaths: parsePathLines(savePathsText),
          trackingPaths: parsePathLines(trackingPathsText),
        };
      }
      const review = [
        "Save backup settings. These control future automatic backups and recovery operations.",
      ];
      if (next.enabled !== state.settings.enabled) {
        review.push(
          next.enabled
            ? "Enable automatic backups."
            : "Disable ALL automatic backups. Future game sessions will not be protected automatically."
        );
      }
      if (next.destination !== state.settings.destination) {
        review.push(
          "Change backup destination. Existing backups will not be moved."
        );
      }
      for (const [key, value] of Object.entries(next.games)) {
        if (
          (value.enabled !== false) !==
          (state.settings.games[key]?.enabled !== false)
        ) {
          const title =
            state.games.find((game) => game.key === key)?.title ?? key;
          review.push(
            value.enabled !== false
              ? `Enable automatic backups for ${title}.`
              : `Disable automatic backups for ${title}. Future sessions of this game will not be protected automatically.`
          );
        }
      }
      if (retentionReduced) {
        review.push(
          "Reduce retained versions. Older backup versions may be deleted during future backups."
        );
      }
      if (pathsDirty) {
        review.push(
          "Change custom save or process paths for the selected game."
        );
      }
      if (!(await confirm("save", review))) {
        throw new Error("Changes were not saved.");
      }
      const saved =
        await globalThis.window.electron.saveLudusaviLocalSettings(next);
      setSettings(saved.settings);
      setSavedSettings(saved.settings);
      setRetentionAcknowledged(false);
      setPathsAcknowledged(false);
      discardPaths();
      setNotice("Backup settings saved.");
    }, "Backup settings saved");

  const handleScanDiscovery = (source: "saves" | "backups") =>
    void runTask(async () => {
      const currentGen = generation.current;
      setDiscoveryNotice("");
      setScanProgress(undefined);
      setScanning(true);
      try {
        const value =
          await globalThis.window.electron.scanDetectedSaveGames(source);
        if (currentGen !== generation.current) return;
        setDiscoveryEntries(value);
        setDiscoveryQuery("");
        setDiscoveryFilter("all");
        setDiscoveryNotice(t("discovery_count", { count: value.length }));
      } finally {
        setScanning(false);
      }
    });

  const handleQuickAddDetected = (entry: DetectedSaveGame) =>
    void runTask(async () => {
      const result = await globalThis.window.electron.addDetectedSaveGame({
        entryId: entry.id,
      });
      await updateLibrary();
      setDiscoveryEntries((items) =>
        items.map((item) =>
          item.id === entry.id
            ? {
                ...item,
                matchedGameKey: result.gameKey,
                matchingGameKeys: [result.gameKey],
              }
            : item
        )
      );
      setDiscoveryNotice(t("detected_added", { title: result.title }));
    }, t("discovery_title"));

  const handleAddAllDetected = () =>
    void runTask(async () => {
      if (!unmatchedEntries.length) return;
      let addedCount = 0;
      for (const item of unmatchedEntries) {
        const result = await globalThis.window.electron.addDetectedSaveGame({
          entryId: item.id,
        });
        addedCount += 1;
        setDiscoveryEntries((prev) =>
          prev.map((row) =>
            row.id === item.id
              ? {
                  ...row,
                  matchedGameKey: result.gameKey,
                  matchingGameKeys: [result.gameKey],
                }
              : row
          )
        );
      }
      await updateLibrary();
      setDiscoveryNotice(t("detected_added_all", { count: addedCount }));
    });

  const refreshVersionsAndSnapshots = async (
    currentGen: number,
    silentEmpty = false
  ) => {
    if (!selectedGameKey) return;
    const result =
      await globalThis.window.electron.listSaveBackupVersions(selectedGameKey);
    if (currentGen !== generation.current) return;
    const sorted = [...result.versions].sort((a, b) =>
      b.when.localeCompare(a.when)
    );
    const sortedSnapshots = [...(result.snapshots ?? [])].sort((a, b) =>
      b.when.localeCompare(a.when)
    );
    setVersions(sorted);
    setSelectedVersion((prev) =>
      sorted.some((item) => item.name === prev) ? prev : (sorted[0]?.name ?? "")
    );
    setSnapshots(sortedSnapshots);
    setSelectedSnapshotId((prev) =>
      sortedSnapshots.some((item) => item.id === prev)
        ? prev
        : (sortedSnapshots[0]?.id ?? "")
    );
    if (!silentEmpty) {
      setPreview(null);
      if (!sorted.length && !sortedSnapshots.length)
        setNotice(t("no_versions"));
    }
  };

  const handleLoadVersions = () =>
    void runTask(async () => {
      await refreshVersionsAndSnapshots(generation.current);
    });

  const handlePreviewRestore = (snapshot?: { id: string; backup: string }) =>
    void runTask(async () => {
      if (!selectedGameKey) return;
      const backupName = snapshot ? snapshot.backup : selectedVersion;
      if (!backupName) return;
      const currentGen = generation.current;
      const result = await globalThis.window.electron.previewSaveRestore(
        selectedGameKey,
        backupName,
        snapshot?.id
      );
      if (currentGen !== generation.current) return;
      setPreview(result);
      setRestoreUnderstood(false);
    });

  const handleConfirmRestore = () =>
    void runTask(async () => {
      if (!preview || !restoreUnderstood || Date.now() >= preview.expiresAt)
        return;
      const currentGen = generation.current;
      const token = preview.token;
      const res = await globalThis.window.electron.confirmSaveOperation(token);
      setPreview(null);
      setRestoreUnderstood(false);
      setLastSafetySnapshot(
        res.safetySnapshotId && res.safetyBackupName
          ? { id: res.safetySnapshotId, backup: res.safetyBackupName }
          : null
      );
      setNotice(
        res.message +
          (res.safetyPath ? ` ${t("safety_location")}: ${res.safetyPath}` : "")
      );
      await refreshVersionsAndSnapshots(currentGen, true);
    }, t("confirm_restore"));

  const gameOptions = [
    ...(sortedGames.length > 1
      ? [{ value: "", label: t("select_game_placeholder") }]
      : []),
    ...sortedGames.map((game) => ({
      value: game.key,
      label: game.title,
    })),
  ];

  const selectGame = async (key: string) => {
    if (busy) return false;
    if (key === selectedGameKey) return true;
    if (
      pathsDirty &&
      !(await confirm("discard", [
        "Discard unsaved custom save and process paths for the current game?",
      ]))
    )
      return false;
    generation.current += 1;
    discardPaths();
    setPathsAcknowledged(false);
    setSelectedGameKey(key);
    setPreview(null);
    return true;
  };

  const versionOptions = versions.map((item) => ({
    value: item.name,
    label: `${new Date(item.when).toLocaleString()} · ${item.name}${
      item.locked ? ` · ${t("locked")}` : ""
    }`,
  }));

  const selectedSnapshot = snapshots.find(
    (item) => item.id === selectedSnapshotId
  );
  const snapshotOptions = snapshots.map((item) => ({
    value: item.id,
    label: `${new Date(item.when).toLocaleString()} · ${t("preview_count", {
      files: item.files,
      registry: item.hasRegistry ? 1 : 0,
    })}${item.hasRegistry ? ` · ${t("snapshot_registry_badge")}` : ""} · ${item.id.slice(0, 8)}`,
  }));

  return (
    <VerticalFocusGroup
      regionId={SAVE_BACKUPS_SECTION_REGION_ID}
      className={className ? `bp-save-backups ${className}` : "bp-save-backups"}
    >
      <SettingsSection title={t("title")} description={t("description")}>
        <div className="bp-save-backups__header-card">
          <div className="bp-save-backups__header-meta">
            <span
              className={`bp-save-backups__badge ${
                settings.enabled
                  ? "bp-save-backups__badge--enabled"
                  : "bp-save-backups__badge--disabled"
              }`}
            >
              {settings.enabled ? t("status_enabled") : t("status_disabled")}
            </span>
            <p className="bp-save-backups__hint">{t("cloud_notice")}</p>
            {latestBackup && (
              <p className="bp-save-backups__status">
                {t("latest_backup")}: {formatDateTime(latestBackup.at)} ·{" "}
                {latestBackup.title} ({t(`status_${latestBackup.status}`)})
              </p>
            )}
          </div>

          <GridFocusGroup
            regionId="bp-save-backups-top-actions"
            className="bp-save-backups__actions"
          >
            <Button
              focusId={SAVE_BACKUPS_PRIMARY_BUTTON_ID}
              variant={subview === "overview" ? "primary" : "secondary"}
              onClick={() => setSubview("overview")}
            >
              Overview
            </Button>
            <Button
              variant={subview === "discovery" ? "primary" : "secondary"}
              onClick={() => setSubview("discovery")}
            >
              {t("discovery_title")}
            </Button>
            {advanced && (
              <Button
                variant={subview === "restore" ? "primary" : "secondary"}
                onClick={() => setSubview("restore")}
              >
                Save versions &amp; restore
              </Button>
            )}
            {advanced && (
              <Button
                variant={subview === "rules" ? "primary" : "secondary"}
                onClick={() => setSubview("rules")}
              >
                Rules & Destination
              </Button>
            )}
            {advanced && (
              <Button
                variant={subview === "config" ? "primary" : "secondary"}
                onClick={() => setSubview("config")}
              >
                Hydra Config
              </Button>
            )}
            <Button
              variant="secondary"
              disabled={busy}
              onClick={() =>
                void runTask(() =>
                  globalThis.window.electron.openLudusaviLocalFolder()
                )
              }
            >
              {t("open_destination")}
            </Button>
          </GridFocusGroup>
        </div>

        {error && (
          <p role="alert" className="bp-save-backups__error">
            {error}
          </p>
        )}
        {notice && (
          <p role="status" className="bp-save-backups__notice">
            {notice}
          </p>
        )}
      </SettingsSection>

      {subview === "overview" && (
        <SettingsSection
          title={t("bulk_title")}
          description={t("bulk_description")}
        >
          <div className="bp-save-backups__panel">
            <Checkbox
              id="bp-save-include-disabled"
              label={t("include_disabled_games")}
              checked={includeDisabledBulk}
              disabled={busy}
              onChange={setIncludeDisabledBulk}
              block
            />
            <Checkbox
              id="bp-save-include-hydra-config"
              label={t("include_hydra_config_bulk")}
              checked={includeHydraConfigBulk}
              disabled={busy}
              onChange={setIncludeHydraConfigBulk}
              block
            />

            <div className="bp-save-backups__row">
              <Button
                variant="primary"
                disabled={
                  busy || (!sortedGames.length && !includeHydraConfigBulk)
                }
                onClick={() =>
                  void runTask(
                    () =>
                      globalThis.window.electron.runLudusaviLocalBulkBackup(
                        includeDisabledBulk,
                        includeHydraConfigBulk
                      ),
                    t("backup_all")
                  )
                }
              >
                {t("backup_all")}
              </Button>
              <Button
                variant="secondary"
                disabled={busy}
                onClick={() =>
                  void runTask(async () => {
                    const res =
                      await globalThis.window.electron.backupHydraConfig(false);
                    setNotice(res.message);
                  }, t("config_backup_now"))
                }
              >
                {t("config_backup_now")}
              </Button>
            </div>

            {bulk.running && (
              <p role="status" className="bp-save-backups__notice">
                {t("backup_all_running", {
                  completed: bulk.completed,
                  total: bulk.total,
                  title: bulk.currentGameTitle ?? "",
                })}
              </p>
            )}

            <Input
              label={t("overview_col_game")}
              placeholder={t("overview_filter_placeholder")}
              value={overviewFilter}
              onChange={(event) => setOverviewFilter(event.target.value)}
            />

            {!filteredGames.length ? (
              <p className="bp-save-backups__hint">{t("no_games")}</p>
            ) : (
              <div className="bp-save-backups__list">
                {filteredGames.map((game) => {
                  const summary = state.gameSummaries?.[game.key];
                  const isActive = state.activeGameKey === game.key;
                  const statusLabel = isActive
                    ? t("pill_backing_up")
                    : summary?.lastAttemptStatus === "failed"
                      ? `${t("pill_backup_failed")}${summary.lastError ? ` · ${summary.lastError}` : ""}`
                      : summary?.lastBackupAt
                        ? formatDistance(
                            new Date(summary.lastBackupAt),
                            new Date(),
                            { addSuffix: true }
                          )
                        : t("never_backed_up");

                  return (
                    <div key={game.key} className="bp-save-backups__item-card">
                      <div className="bp-save-backups__item-info">
                        <strong>{game.title}</strong>
                        <span>{statusLabel}</span>
                      </div>
                      <GridFocusGroup className="bp-save-backups__actions">
                        <Button
                          variant="secondary"
                          size="small"
                          disabled={busy}
                          onClick={() =>
                            void runTask(
                              () =>
                                globalThis.window.electron.runLudusaviLocalBackup(
                                  game.key,
                                  false
                                ),
                              t("backup_now")
                            )
                          }
                        >
                          {t("overview_backup_short")}
                        </Button>
                        <Button
                          variant="secondary"
                          size="small"
                          disabled={busy}
                          onClick={async () => {
                            if (!advanced) {
                              navigate(
                                `/big-picture/settings?tab=advanced&game=${encodeURIComponent(game.key)}`
                              );
                              return;
                            }
                            if (await selectGame(game.key))
                              setSubview("restore");
                          }}
                        >
                          {t("overview_manage")}
                        </Button>
                      </GridFocusGroup>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </SettingsSection>
      )}

      {subview === "discovery" && (
        <SettingsSection
          title={t("discovery_title")}
          description={t("discovery_description")}
        >
          <div className="bp-save-backups__panel">
            <GridFocusGroup className="bp-save-backups__actions">
              {(["saves", "backups"] as const).map((source) => (
                <Button
                  key={source}
                  variant="secondary"
                  disabled={busy}
                  onClick={() => handleScanDiscovery(source)}
                >
                  {t(`discover_${source}`)}
                </Button>
              ))}
              {unmatchedEntries.length > 0 && (
                <Button
                  variant="primary"
                  disabled={busy}
                  onClick={handleAddAllDetected}
                >
                  {t("add_all_detected", { count: unmatchedEntries.length })}
                </Button>
              )}
            </GridFocusGroup>

            {scanning && (
              <p className="bp-save-backups__notice" role="status">
                {t(`discovery_phase_${scanProgress?.phase ?? "preparing"}`)}
                {scanProgress?.total !== undefined
                  ? ` (${scanProgress.completed}/${scanProgress.total})`
                  : ""}
              </p>
            )}

            {discoveryNotice && (
              <p className="bp-save-backups__notice" role="status">
                {discoveryNotice}
              </p>
            )}

            {discoveryEntries.length > 0 && (
              <>
                <GridFocusGroup className="bp-save-backups__actions">
                  {(
                    [
                      [
                        "all",
                        t("filter_all", { count: discoveryEntries.length }),
                      ],
                      [
                        "unmatched",
                        t("filter_unmatched", {
                          count: unmatchedEntries.length,
                        }),
                      ],
                      [
                        "matched",
                        t("filter_matched", { count: matchedEntries.length }),
                      ],
                    ] as const
                  ).map(([filterKey, label]) => (
                    <Button
                      key={filterKey}
                      size="small"
                      variant={
                        discoveryFilter === filterKey ? "primary" : "secondary"
                      }
                      onClick={() => setDiscoveryFilter(filterKey)}
                    >
                      {label}
                    </Button>
                  ))}
                </GridFocusGroup>

                <Input
                  placeholder={t("filter_detected")}
                  value={discoveryQuery}
                  onChange={(event) => setDiscoveryQuery(event.target.value)}
                />

                <div className="bp-save-backups__list">
                  {filteredDiscoveryEntries.map((entry) => {
                    const matched = isInLibrary(entry);
                    return (
                      <div
                        key={entry.id}
                        className="bp-save-backups__item-card"
                      >
                        <div className="bp-save-backups__item-info">
                          <strong>{entry.title}</strong>
                          <span>
                            {matched
                              ? t("status_enabled")
                              : t("not_installed_badge")}{" "}
                            · {entry.files} files · {entry.versions} versions
                          </span>
                        </div>
                        <div className="bp-save-backups__actions">
                          {matched &&
                          entry.matchedShop &&
                          entry.matchedObjectId ? (
                            <Button
                              variant="secondary"
                              size="small"
                              onClick={() =>
                                navigate(
                                  `/big-picture/game/${entry.matchedShop}/${entry.matchedObjectId}`
                                )
                              }
                            >
                              {t("overview_manage")}
                            </Button>
                          ) : (
                            <Button
                              variant="primary"
                              size="small"
                              disabled={busy}
                              onClick={() => handleQuickAddDetected(entry)}
                            >
                              {t("add_detected")}
                            </Button>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </>
            )}
          </div>
        </SettingsSection>
      )}

      {advanced && subview === "restore" && (
        <SettingsSection
          title="Restore & Versions"
          description={t("per_game_section_description")}
        >
          <div className="bp-save-backups__panel">
            {sortedGames.length > 0 ? (
              <DropdownSelect
                label={t("backup_game_selection")}
                value={selectedGameKey}
                options={gameOptions}
                disabled={busy}
                onValueChange={(key) => void selectGame(key)}
              />
            ) : (
              <p className="bp-save-backups__hint">{t("no_games")}</p>
            )}

            {sortedGames.length > 0 && !selectedGameKey && (
              <p className="bp-save-backups__notice" role="status">
                {t("select_game_empty_prompt")}
              </p>
            )}

            {selectedGameKey && (
              <>
                <GridFocusGroup className="bp-save-backups__actions">
                  <Button
                    variant="secondary"
                    disabled={busy || !selectedGameKey}
                    onClick={handleLoadVersions}
                  >
                    {t("load_versions")}
                  </Button>
                  <Button
                    variant="primary"
                    disabled={busy || !selectedGameKey}
                    onClick={() =>
                      void runTask(
                        () =>
                          globalThis.window.electron.runLudusaviLocalBackup(
                            selectedGameKey,
                            false
                          ),
                        t("backup_now")
                      )
                    }
                  >
                    {t("backup_now")}
                  </Button>
                  <Button
                    variant="secondary"
                    disabled={busy || !selectedGameKey}
                    onClick={() =>
                      void runTask(() =>
                        globalThis.window.electron.runLudusaviLocalBackup(
                          selectedGameKey,
                          true
                        )
                      )
                    }
                  >
                    {t("preview")}
                  </Button>
                </GridFocusGroup>

                {versionOptions.length > 0 && (
                  <>
                    <DropdownSelect
                      label={t("version")}
                      value={selectedVersion}
                      options={versionOptions}
                      onValueChange={(nextVersion) => {
                        setSelectedVersion(nextVersion);
                        setPreview(null);
                        setRestoreUnderstood(false);
                      }}
                    />

                    <GridFocusGroup className="bp-save-backups__actions">
                      <Button
                        variant="primary"
                        disabled={busy || !selectedVersion}
                        onClick={() => handlePreviewRestore()}
                      >
                        {t("preview_restore")}
                      </Button>
                      <Button
                        variant="secondary"
                        disabled={busy || !selectedVersion}
                        onClick={() =>
                          void runTask(async () => {
                            const result =
                              await globalThis.window.electron.validateSaveBackup(
                                selectedGameKey,
                                selectedVersion
                              );
                            setNotice(result.message);
                          })
                        }
                      >
                        {t("validate_version")}
                      </Button>
                    </GridFocusGroup>
                  </>
                )}

                {lastSafetySnapshot && (
                  <div className="bp-save-backups__actions">
                    <Button
                      variant="secondary"
                      disabled={busy}
                      onClick={() => handlePreviewRestore(lastSafetySnapshot)}
                    >
                      {t("undo_last_restore")}
                    </Button>
                  </div>
                )}

                {snapshotOptions.length > 0 && (
                  <>
                    <DropdownSelect
                      label={t("safety_snapshots_title")}
                      value={selectedSnapshotId}
                      options={snapshotOptions}
                      onValueChange={(nextId) => {
                        setSelectedSnapshotId(nextId);
                        setPreview(null);
                        setRestoreUnderstood(false);
                      }}
                    />

                    <GridFocusGroup className="bp-save-backups__actions">
                      <Button
                        variant="primary"
                        disabled={busy || !selectedSnapshot}
                        onClick={() =>
                          selectedSnapshot &&
                          handlePreviewRestore({
                            id: selectedSnapshot.id,
                            backup: selectedSnapshot.backup,
                          })
                        }
                      >
                        {t("preview_snapshot_restore")}
                      </Button>
                      <Button
                        variant="secondary"
                        disabled={busy || !selectedSnapshot}
                        onClick={() =>
                          void runTask(async () => {
                            if (!selectedSnapshot) return;
                            const result =
                              await globalThis.window.electron.validateSaveBackup(
                                selectedGameKey,
                                selectedSnapshot.backup,
                                selectedSnapshot.id
                              );
                            setNotice(result.message);
                          })
                        }
                      >
                        {t("validate_snapshot")}
                      </Button>
                    </GridFocusGroup>
                  </>
                )}

                {preview && (
                  <div className="bp-save-backups__preview-box">
                    <p className="bp-save-backups__notice">
                      {preview.snapshotId ? `${t("safety_snapshot")} · ` : ""}
                      {t(`confirm_${preview.operation}_notice`)} (
                      {preview.files.length} files)
                    </p>
                    <Checkbox
                      id="bp-save-restore-understood"
                      label={t("confirm_understood")}
                      checked={restoreUnderstood}
                      onChange={setRestoreUnderstood}
                      block
                    />
                    <GridFocusGroup className="bp-save-backups__actions">
                      <Button
                        variant="primary"
                        disabled={
                          busy ||
                          !restoreUnderstood ||
                          Date.now() >= preview.expiresAt
                        }
                        onClick={handleConfirmRestore}
                      >
                        {t(`confirm_${preview.operation}`)}
                      </Button>
                      <Button
                        variant="secondary"
                        onClick={() => {
                          setPreview(null);
                          setRestoreUnderstood(false);
                        }}
                      >
                        {t("cancel_clear")}
                      </Button>
                    </GridFocusGroup>
                  </div>
                )}

                <div className="bp-save-backups__panel">
                  <Checkbox
                    id="bp-save-selected-game-enabled"
                    label={`${t("enable_game")} (${sortedGames.find((g) => g.key === selectedGameKey)?.title ?? selectedGameKey})`}
                    checked={selectedGameSettings.enabled !== false}
                    disabled={busy}
                    onChange={(checked) =>
                      setSettings((current) =>
                        current
                          ? withGameBackupEnabled(
                              current,
                              savedSettings,
                              selectedGameKey,
                              checked
                            )
                          : current
                      )
                    }
                    block
                  />

                  <label className="bp-save-backups__textarea-label">
                    <span>{t("save_paths")}</span>
                    <textarea
                      rows={3}
                      value={savePathsText}
                      disabled={busy}
                      onChange={(event) => {
                        setSavePathsText(event.target.value);
                        setPathsAcknowledged(false);
                      }}
                    />
                  </label>

                  <label className="bp-save-backups__textarea-label">
                    <span>{t("tracking_paths")}</span>
                    <textarea
                      rows={3}
                      value={trackingPathsText}
                      disabled={busy}
                      onChange={(event) => {
                        setTrackingPathsText(event.target.value);
                        setPathsAcknowledged(false);
                      }}
                    />
                  </label>

                  {pathsDirty && (
                    <Checkbox
                      id="bp-save-paths-ack"
                      label={t("paths_acknowledgement")}
                      checked={pathsAcknowledged}
                      onChange={setPathsAcknowledged}
                      block
                    />
                  )}

                  <div className="bp-save-backups__actions">
                    <Button
                      variant="primary"
                      disabled={busy || !canSaveRules}
                      onClick={handleSaveRules}
                    >
                      Save backup settings
                    </Button>
                  </div>
                </div>
              </>
            )}
          </div>
        </SettingsSection>
      )}

      {advanced && subview === "rules" && (
        <SettingsSection
          title="Rules & Destination"
          description={t("global_policy_section_description")}
        >
          <div className="bp-save-backups__panel">
            <Checkbox
              id="bp-save-global-enabled"
              label={t("enable")}
              checked={settings.enabled}
              disabled={busy}
              onChange={(checked) =>
                setSettings((current) =>
                  current ? { ...current, enabled: checked } : current
                )
              }
              block
            />

            <GridFocusGroup className="bp-save-backups__row">
              <Input
                label={t("destination")}
                value={settings.destination}
                disabled={busy}
                onChange={(event) =>
                  setSettings((current) =>
                    current
                      ? { ...current, destination: event.target.value }
                      : current
                  )
                }
              />
              <Button
                variant="secondary"
                disabled={busy}
                onClick={() =>
                  void globalThis.window.electron
                    .showOpenDialog({
                      properties: ["openDirectory", "createDirectory"],
                      defaultPath: settings.destination,
                    })
                    .then((result) => {
                      if (result.filePaths[0]) {
                        setSettings((current) =>
                          current
                            ? { ...current, destination: result.filePaths[0] }
                            : current
                        );
                      }
                    })
                }
              >
                {t("browse")}
              </Button>
            </GridFocusGroup>

            <GridFocusGroup className="bp-save-backups__grid-2">
              <Input
                label={t("retention")}
                type="number"
                min={1}
                max={255}
                value={String(settings.fullRetention)}
                disabled={busy}
                onChange={(event) => {
                  setRetentionAcknowledged(false);
                  setSettings((current) =>
                    current
                      ? {
                          ...current,
                          fullRetention: Number(event.target.value),
                        }
                      : current
                  );
                }}
              />
              <Input
                label={t("differential_retention")}
                type="number"
                min={0}
                max={255}
                value={String(settings.differentialRetention ?? 0)}
                disabled={busy}
                onChange={(event) => {
                  setRetentionAcknowledged(false);
                  setSettings((current) =>
                    current
                      ? {
                          ...current,
                          differentialRetention: Number(event.target.value),
                        }
                      : current
                  );
                }}
              />
            </GridFocusGroup>

            {retentionReduced && (
              <Checkbox
                id="bp-save-retention-ack"
                label={t("retention_acknowledgement")}
                checked={retentionAcknowledged}
                onChange={setRetentionAcknowledged}
                block
              />
            )}

            <GridFocusGroup className="bp-save-backups__actions">
              <Button
                variant="primary"
                disabled={busy || !canSaveRules}
                onClick={handleSaveRules}
              >
                Save backup settings
              </Button>
              <Button
                variant="secondary"
                disabled={busy}
                onClick={() =>
                  void runTask(() =>
                    globalThis.window.electron.updateSaveManifest()
                  )
                }
              >
                {t("update_manifest")}
              </Button>
              <Button
                variant="secondary"
                disabled={busy}
                onClick={() =>
                  void runTask(() =>
                    globalThis.window.electron.openLudusaviLocalFolder(true)
                  )
                }
              >
                {t("open_logs")}
              </Button>
              <Button
                variant="danger"
                disabled={busy}
                onClick={() => setConfirmClear(true)}
              >
                {t("clear_logs")}
              </Button>
            </GridFocusGroup>
          </div>
        </SettingsSection>
      )}

      {advanced && subview === "config" && (
        <BigPictureHydraConfigSection
          busy={busy}
          onRestored={async () => {
            const latest = await refresh();
            setSettings(latest.settings);
            setSavedSettings(latest.settings);
          }}
        />
      )}

      <ConfirmationModal
        visible={confirmClear}
        title={t("clear_logs")}
        description={t("clear_logs_confirmation")}
        confirmLabel={t("clear_logs")}
        danger
        onClose={() => setConfirmClear(false)}
        onConfirm={() => {
          setConfirmClear(false);
          void runTask(
            () => globalThis.window.electron.clearLudusaviLocalLogs(),
            t("clear_logs")
          );
        }}
      />
    </VerticalFocusGroup>
  );
}
