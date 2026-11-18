import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button, CheckboxField, Modal, TextField } from "@renderer/components";
import { useGameCollections, useLibrary, useToast } from "@renderer/hooks";
import {
  filterExcludedLibraryGames,
  formatBulkLibraryRemovalConfirmation,
  getBulkLibraryRemovalBlockReason,
  getExcludedLibraryGameKey,
  isLibraryGameDownloading,
  type BulkLibraryRemovalBlockReason,
  type BulkLibraryRemovalResult,
} from "@shared";
import type {
  ExcludedLibraryGame,
  GameShop,
  LibraryExclusionReason,
  LibraryGame,
} from "@types";
import "./settings-bulk-remove-library.scss";

type ManagementTab = "library" | "excluded";

type LibraryFilter =
  | "all"
  | "steam"
  | "no_executable"
  | "no_playtime"
  | "with_executable"
  | "hidden";

type ExcludedShopFilter = GameShop | "all";

interface DecoratedLibraryEntry {
  key: string;
  game: LibraryGame;
  blockReason: BulkLibraryRemovalBlockReason | null;
  hasExecutable: boolean;
  playtimeMinutes: number;
  isSteamImport: boolean;
}

const getGameKey = (game: Pick<LibraryGame, "shop" | "objectId">) =>
  `${game.shop}:${game.objectId}`;

const formatPlaytimeShort = (minutes: number): string => {
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h`;
};

const EXCLUDED_SHOPS: { key: GameShop; label: string }[] = [
  { key: "steam", label: "Steam" },
  { key: "epic", label: "Epic" },
  { key: "launchbox", label: "LaunchBox" },
  { key: "custom", label: "Custom" },
];

const EXCLUSION_REASON_LABEL: Record<LibraryExclusionReason, string> = {
  removed: "Removed from library",
  manual: "Excluded manually",
  "steam-bulk": "Steam bulk exclude",
  bulk: "Bulk removed",
};

export function SettingsBulkRemoveLibrary() {
  const { t } = useTranslation("settings");
  const { library, updateLibrary } = useLibrary();
  const { loadCollections } = useGameCollections();
  const { showSuccessToast, showErrorToast } = useToast();

  const [activeTab, setActiveTab] = useState<ManagementTab>("library");

  // Library selection state
  const [runningIds, setRunningIds] = useState<Set<string>>(() => new Set());
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<LibraryFilter>("all");
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(
    () => new Set()
  );

  const [confirmOpen, setConfirmOpen] = useState(false);
  const [acknowledged, setAcknowledged] = useState(false);
  const [confirmationText, setConfirmationText] = useState("");
  const [removing, setRemoving] = useState(false);
  const [error, setError] = useState("");
  const [lastResult, setLastResult] = useState<BulkLibraryRemovalResult | null>(
    null
  );

  // Exclusions state
  const [excludedGames, setExcludedGames] = useState<ExcludedLibraryGame[]>([]);
  const [excludedSearch, setExcludedSearch] = useState("");
  const [excludedShopFilter, setExcludedShopFilter] =
    useState<ExcludedShopFilter>("all");
  const [selectedExcludedKeys, setSelectedExcludedKeys] = useState<Set<string>>(
    () => new Set()
  );
  const [exclusionConfirmAction, setExclusionConfirmAction] = useState<
    "exclude-steam" | "clear-all" | null
  >(null);
  const [exclusionBusy, setExclusionBusy] = useState(false);
  const [statusMessage, setStatusMessage] = useState("");

  useEffect(() => {
    void updateLibrary();
  }, [updateLibrary]);

  useEffect(() => {
    let active = true;
    window.electron
      .getGamesRunning()
      .then((games) => {
        if (active) {
          setRunningIds(new Set(games.map((game) => game.id)));
        }
      })
      .catch(() => {});

    const unsubscribe = window.electron.onGamesRunning((games) => {
      setRunningIds(new Set(games.map((game) => game.id)));
    });

    return () => {
      active = false;
      unsubscribe();
    };
  }, []);

  useEffect(() => {
    let active = true;
    window.electron
      .getExcludedLibraryGames()
      .then((entries) => {
        if (active) setExcludedGames(entries);
      })
      .catch(() => {});

    const unsubscribe = window.electron.onExcludedLibraryGamesUpdated(
      (entries) => {
        setExcludedGames(entries);
      }
    );

    return () => {
      active = false;
      unsubscribe();
    };
  }, []);

  const entries = useMemo<DecoratedLibraryEntry[]>(() => {
    return [...library]
      .filter((game) => !game.isDeleted)
      .sort((a, b) => a.title.localeCompare(b.title))
      .map((game) => {
        const key = getGameKey(game);
        const isRunning = runningIds.has(game.id) || runningIds.has(key);
        const isDownloading = isLibraryGameDownloading(game);
        const isSteamImport = Boolean(
          game.hasActiveSteamImport ||
            game.source === "steam" ||
            game.shop === "steam"
        );
        return {
          key,
          game,
          blockReason: getBulkLibraryRemovalBlockReason({
            isRunning,
            isDownloading,
          }),
          hasExecutable: Boolean(game.executablePath?.trim()),
          playtimeMinutes: Math.round(
            (game.playTimeInMilliseconds ?? 0) / 60_000
          ),
          isSteamImport,
        };
      });
  }, [library, runningIds]);

  const entryMap = useMemo(
    () => new Map(entries.map((entry) => [entry.key, entry])),
    [entries]
  );

  useEffect(() => {
    setSelectedKeys((previous) => {
      let changed = false;
      const next = new Set<string>();
      for (const key of previous) {
        const entry = entryMap.get(key);
        if (entry && !entry.blockReason) {
          next.add(key);
        } else {
          changed = true;
        }
      }
      return changed ? next : previous;
    });
  }, [entryMap]);

  const hiddenCount = useMemo(
    () => entries.filter((entry) => entry.game.isConcealed).length,
    [entries]
  );

  const steamEntries = useMemo(
    () => entries.filter((entry) => entry.isSteamImport),
    [entries]
  );

  const filteredEntries = useMemo(() => {
    const query = search.trim().toLowerCase();
    return entries.filter((entry) => {
      if (query && !entry.game.title.toLowerCase().includes(query)) {
        return false;
      }
      if (filter === "steam") return entry.isSteamImport;
      if (filter === "no_executable") return !entry.hasExecutable;
      if (filter === "with_executable") return entry.hasExecutable;
      if (filter === "no_playtime") return entry.playtimeMinutes === 0;
      if (filter === "hidden") return Boolean(entry.game.isConcealed);
      return true;
    });
  }, [entries, filter, search]);

  const eligibleFilteredKeys = useMemo(
    () =>
      filteredEntries
        .filter((entry) => !entry.blockReason)
        .map((entry) => entry.key),
    [filteredEntries]
  );

  const selectedEntries = useMemo(
    () =>
      entries.filter(
        (entry) => selectedKeys.has(entry.key) && !entry.blockReason
      ),
    [entries, selectedKeys]
  );

  const selectedWithWarningsCount = useMemo(
    () =>
      selectedEntries.filter(
        (entry) =>
          entry.hasExecutable ||
          entry.playtimeMinutes > 0 ||
          entry.game.favorite
      ).length,
    [selectedEntries]
  );

  const expectedPhrase = formatBulkLibraryRemovalConfirmation(
    selectedEntries.length
  );

  const filteredExclusions = useMemo(
    () =>
      filterExcludedLibraryGames(excludedGames, {
        query: excludedSearch,
        shop: excludedShopFilter,
      }),
    [excludedGames, excludedSearch, excludedShopFilter]
  );

  const excludedKeySet = useMemo(
    () =>
      new Set(
        excludedGames.map((entry) =>
          getExcludedLibraryGameKey(entry.shop, entry.objectId)
        )
      ),
    [excludedGames]
  );

  useEffect(() => {
    setSelectedExcludedKeys((previous) => {
      let changed = false;
      const next = new Set<string>();
      for (const key of previous) {
        if (excludedKeySet.has(key)) next.add(key);
        else changed = true;
      }
      return changed ? next : previous;
    });
  }, [excludedKeySet]);

  const selectedExcludedEntries = useMemo(
    () =>
      excludedGames.filter((entry) =>
        selectedExcludedKeys.has(
          getExcludedLibraryGameKey(entry.shop, entry.objectId)
        )
      ),
    [excludedGames, selectedExcludedKeys]
  );

  const shopCounts = useMemo(() => {
    const counts: Record<string, number> = { all: excludedGames.length };
    for (const entry of excludedGames) {
      counts[entry.shop] = (counts[entry.shop] ?? 0) + 1;
    }
    return counts;
  }, [excludedGames]);

  const toggleKey = (key: string) => {
    const entry = entryMap.get(key);
    if (!entry || entry.blockReason) return;

    setSelectedKeys((previous) => {
      const next = new Set(previous);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const selectAllFiltered = () => {
    setSelectedKeys((previous) => {
      const next = new Set(previous);
      for (const key of eligibleFilteredKeys) next.add(key);
      return next;
    });
  };

  const clearSelection = () => {
    setSelectedKeys(new Set());
  };

  const toggleExcludedKey = (key: string) => {
    setSelectedExcludedKeys((previous) => {
      const next = new Set(previous);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const selectAllFilteredExcluded = () => {
    setSelectedExcludedKeys((previous) => {
      const next = new Set(previous);
      for (const entry of filteredExclusions) {
        next.add(getExcludedLibraryGameKey(entry.shop, entry.objectId));
      }
      return next;
    });
  };

  const clearExcludedSelection = () => {
    setSelectedExcludedKeys(new Set());
  };

  const openConfirmationModal = () => {
    if (selectedEntries.length === 0) return;
    setAcknowledged(false);
    setConfirmationText("");
    setError("");
    setConfirmOpen(true);
  };

  const closeConfirmationModal = () => {
    if (removing) return;
    setConfirmOpen(false);
    setAcknowledged(false);
    setConfirmationText("");
    setError("");
  };

  const handleConfirmRemoval = async () => {
    if (
      removing ||
      selectedEntries.length === 0 ||
      !acknowledged ||
      confirmationText !== expectedPhrase
    ) {
      return;
    }

    setRemoving(true);
    setError("");
    setStatusMessage("");

    try {
      const result = await window.electron.bulkRemoveGamesFromLibrary(
        selectedEntries.map((entry) => ({
          shop: entry.game.shop,
          objectId: entry.game.objectId,
        })),
        confirmationText
      );

      setLastResult(result);

      for (const removed of result.removed) {
        window.dispatchEvent(
          new CustomEvent("hydra:game-removed-from-library", {
            detail: {
              shop: removed.shop,
              objectId: removed.objectId,
            },
          })
        );
      }

      if (result.failed.length > 0) {
        const message = t("bulk_remove_partial_failure", {
          removed: result.removed.length,
          failed: result.failed.length,
        });
        setError(message);
        showErrorToast(message);
      } else {
        setSelectedKeys(new Set());
        setConfirmOpen(false);
        setAcknowledged(false);
        setConfirmationText("");
        showSuccessToast(
          t("bulk_remove_success_toast", {
            count: result.removed.length,
          })
        );
      }
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : String(caught);
      setError(message);
      showErrorToast(message);
    } finally {
      setRemoving(false);
      await Promise.all([updateLibrary(), loadCollections()]).catch(() => {});
    }
  };

  const handleRestoreOrUnexclude = async (
    targets: ExcludedLibraryGame[],
    restoreToLibrary: boolean
  ) => {
    if (exclusionBusy || targets.length === 0) return;
    setExclusionBusy(true);
    setError("");
    setStatusMessage("");
    try {
      const result = await window.electron.unexcludeLibraryGames(
        targets.map((entry) => ({
          shop: entry.shop,
          objectId: entry.objectId,
        })),
        { restoreToLibrary }
      );
      setExcludedGames(result.entries);
      setSelectedExcludedKeys(new Set());
      if (restoreToLibrary) {
        await Promise.all([updateLibrary(), loadCollections()]);
      }
      const message =
        targets.length === 1
          ? restoreToLibrary
            ? `Restored "${targets[0].title}" back into your library.`
            : `Removed "${targets[0].title}" from the exclusion list.`
          : restoreToLibrary
            ? `Restored ${result.restoredCount} game(s) back into your library.`
            : `Un-excluded ${result.removedCount} game(s).`;
      setStatusMessage(message);
      showSuccessToast(message);
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : String(caught);
      setError(message);
      showErrorToast(message);
    } finally {
      setExclusionBusy(false);
    }
  };

  const handleConfirmExclusionBulkAction = async () => {
    if (exclusionBusy || !exclusionConfirmAction) return;
    setExclusionBusy(true);
    setError("");
    setStatusMessage("");
    try {
      if (exclusionConfirmAction === "exclude-steam") {
        const removableSteam = steamEntries.filter(
          (entry) => !entry.blockReason
        );
        const result = await window.electron.excludeLibraryGames(
          removableSteam.map((entry) => ({
            shop: entry.game.shop,
            objectId: entry.game.objectId,
            title: entry.game.title,
            source: entry.game.source ?? null,
            iconUrl: entry.game.iconUrl ?? null,
            libraryImageUrl:
              entry.game.libraryImageUrl ?? entry.game.coverImageUrl ?? null,
            reason: "steam-bulk",
          }))
        );
        setExcludedGames(result.entries);
        setSelectedKeys(new Set());
        setExclusionConfirmAction(null);
        await Promise.all([updateLibrary(), loadCollections()]);
        const message = `Removed and excluded ${result.removedFromLibraryCount} Steam game(s) across all syncs and importers.`;
        setStatusMessage(message);
        showSuccessToast(message);
      } else {
        const result = await window.electron.clearExcludedLibraryGames();
        setExcludedGames([]);
        setSelectedExcludedKeys(new Set());
        setExclusionConfirmAction(null);
        const message = `Cleared ${result.removedCount} exclusion(s). Future syncs or scans can re-add them.`;
        setStatusMessage(message);
        showSuccessToast(message);
      }
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : String(caught);
      setError(message);
      showErrorToast(message);
    } finally {
      setExclusionBusy(false);
    }
  };

  const filters: { id: LibraryFilter; label: string; show?: boolean }[] = [
    { id: "all", label: t("bulk_remove_filter_all") },
    {
      id: "steam",
      label: `Steam (${steamEntries.length})`,
      show: steamEntries.length > 0,
    },
    { id: "no_executable", label: t("bulk_remove_filter_no_executable") },
    { id: "no_playtime", label: t("bulk_remove_filter_no_playtime") },
    { id: "with_executable", label: t("bulk_remove_filter_with_executable") },
    {
      id: "hidden",
      label: t("bulk_remove_filter_hidden", { count: hiddenCount }),
      show: hiddenCount > 0,
    },
  ];

  const busy = removing || exclusionBusy;
  const removableSteamCount = steamEntries.filter(
    (entry) => !entry.blockReason
  ).length;

  return (
    <section className="settings-bulk-remove">
      <div>
        <h3>Library management &amp; exclusions</h3>
        <p className="settings-bulk-remove__subtitle">
          Remove titles from your library or restore excluded ones. Any game you
          remove is automatically excluded across Steam sync, Epic sync,
          installed-game scans, LaunchBox, and RetroArch importers until
          restored or manually added again.
        </p>
      </div>

      <div className="settings-bulk-remove__tabs" role="tablist">
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === "library"}
          className={`settings-bulk-remove__tab ${
            activeTab === "library" ? "settings-bulk-remove__tab--active" : ""
          }`}
          onClick={() => setActiveTab("library")}
        >
          In library ({entries.length})
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === "excluded"}
          className={`settings-bulk-remove__tab ${
            activeTab === "excluded" ? "settings-bulk-remove__tab--active" : ""
          }`}
          onClick={() => setActiveTab("excluded")}
        >
          Excluded ({excludedGames.length})
        </button>
      </div>

      {error && (
        <p role="alert" className="settings-bulk-remove__error">
          {error}
        </p>
      )}

      {statusMessage && (
        <p role="status" className="settings-bulk-remove__result">
          {statusMessage}
        </p>
      )}

      {lastResult && activeTab === "library" && (
        <p role="status" className="settings-bulk-remove__result">
          {t("bulk_remove_result_summary", {
            removed: lastResult.removed.length,
            skipped: lastResult.skipped.length,
            failed: lastResult.failed.length,
          })}
        </p>
      )}

      {activeTab === "library" ? (
        <>
          <div className="settings-bulk-remove__controls">
            <div className="settings-bulk-remove__search">
              <TextField
                placeholder={t("bulk_remove_search_placeholder")}
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                disabled={busy}
              />
            </div>
            <Button
              theme="outline"
              disabled={busy || eligibleFilteredKeys.length === 0}
              onClick={selectAllFiltered}
            >
              {t("bulk_remove_select_visible", {
                count: eligibleFilteredKeys.length,
              })}
            </Button>
            <Button
              theme="outline"
              disabled={busy || selectedEntries.length === 0}
              onClick={clearSelection}
            >
              {t("bulk_remove_clear_selection")}
            </Button>
            {removableSteamCount > 0 && (
              <Button
                theme="outline"
                disabled={busy}
                onClick={() => setExclusionConfirmAction("exclude-steam")}
              >
                Exclude all Steam ({removableSteamCount})
              </Button>
            )}
          </div>

          <div className="settings-bulk-remove__filters">
            {filters
              .filter((item) => item.show !== false)
              .map((item) => (
                <button
                  key={item.id}
                  type="button"
                  className={`settings-bulk-remove__filter-pill ${
                    filter === item.id
                      ? "settings-bulk-remove__filter-pill--active"
                      : ""
                  }`}
                  onClick={() => setFilter(item.id)}
                >
                  {item.label}
                </button>
              ))}
          </div>

          <div className="settings-bulk-remove__list">
            {filteredEntries.length === 0 ? (
              <p className="settings-bulk-remove__empty">
                {t("bulk_remove_empty")}
              </p>
            ) : (
              filteredEntries.map((entry) => {
                const isChecked = selectedKeys.has(entry.key);
                return (
                  <div
                    key={entry.key}
                    className={`settings-bulk-remove__row ${
                      entry.blockReason
                        ? "settings-bulk-remove__row--blocked"
                        : ""
                    }`}
                  >
                    <div className="settings-bulk-remove__row-main">
                      <CheckboxField
                        label=""
                        checked={isChecked}
                        disabled={busy || Boolean(entry.blockReason)}
                        onChange={() => toggleKey(entry.key)}
                      />
                      <span
                        className="settings-bulk-remove__row-title"
                        title={entry.game.title}
                      >
                        {entry.game.title}
                      </span>
                    </div>

                    <div className="settings-bulk-remove__badges">
                      <span className="settings-bulk-remove__badge">
                        {entry.game.shop}
                      </span>
                      {entry.hasExecutable && (
                        <span className="settings-bulk-remove__badge settings-bulk-remove__badge--warning">
                          {t("bulk_remove_badge_executable")}
                        </span>
                      )}
                      {entry.playtimeMinutes > 0 && (
                        <span className="settings-bulk-remove__badge settings-bulk-remove__badge--warning">
                          {formatPlaytimeShort(entry.playtimeMinutes)}
                        </span>
                      )}
                      {entry.game.favorite && (
                        <span className="settings-bulk-remove__badge settings-bulk-remove__badge--warning">
                          {t("bulk_remove_badge_favorite")}
                        </span>
                      )}
                      {entry.game.isConcealed && (
                        <span className="settings-bulk-remove__badge">
                          {t("bulk_remove_badge_hidden")}
                        </span>
                      )}
                      {entry.blockReason === "running" && (
                        <span className="settings-bulk-remove__badge settings-bulk-remove__badge--blocked">
                          {t("bulk_remove_badge_running")}
                        </span>
                      )}
                      {entry.blockReason === "downloading" && (
                        <span className="settings-bulk-remove__badge settings-bulk-remove__badge--blocked">
                          {t("bulk_remove_badge_downloading")}
                        </span>
                      )}
                    </div>
                  </div>
                );
              })
            )}
          </div>

          <div className="settings-bulk-remove__footer">
            <span>
              {t("bulk_remove_selected_count", {
                count: selectedEntries.length,
              })}
            </span>
            <div className="settings-bulk-remove__actions">
              <Button
                theme="danger"
                disabled={busy || selectedEntries.length === 0}
                onClick={openConfirmationModal}
              >
                Remove &amp; exclude ({selectedEntries.length})
              </Button>
            </div>
          </div>
        </>
      ) : (
        <>
          <div className="settings-bulk-remove__controls">
            <div className="settings-bulk-remove__search">
              <TextField
                placeholder="Search excluded titles..."
                value={excludedSearch}
                onChange={(event) => setExcludedSearch(event.target.value)}
                disabled={busy}
              />
            </div>
            <Button
              theme="outline"
              disabled={busy || filteredExclusions.length === 0}
              onClick={selectAllFilteredExcluded}
            >
              {t("bulk_remove_select_visible", {
                count: filteredExclusions.length,
              })}
            </Button>
            <Button
              theme="outline"
              disabled={busy || selectedExcludedEntries.length === 0}
              onClick={clearExcludedSelection}
            >
              {t("bulk_remove_clear_selection")}
            </Button>
            <Button
              theme="outline"
              disabled={busy || excludedGames.length === 0}
              onClick={() => setExclusionConfirmAction("clear-all")}
            >
              Clear all ({excludedGames.length})
            </Button>
          </div>

          <div className="settings-bulk-remove__filters">
            {(
              [
                { key: "all", label: `All (${shopCounts.all ?? 0})` },
                ...EXCLUDED_SHOPS.map((shop) => ({
                  key: shop.key,
                  label: `${shop.label} (${shopCounts[shop.key] ?? 0})`,
                })),
              ] as { key: ExcludedShopFilter; label: string }[]
            ).map((pill) => (
              <button
                key={pill.key}
                type="button"
                className={`settings-bulk-remove__filter-pill ${
                  excludedShopFilter === pill.key
                    ? "settings-bulk-remove__filter-pill--active"
                    : ""
                }`}
                onClick={() => setExcludedShopFilter(pill.key)}
              >
                {pill.label}
              </button>
            ))}
          </div>

          <div className="settings-bulk-remove__list">
            {filteredExclusions.length === 0 ? (
              <p className="settings-bulk-remove__empty">
                {excludedGames.length === 0
                  ? "No excluded games yet. Any title removed from your library is automatically added here so syncs and importers do not bring it back."
                  : "No excluded titles match your current search or shop filter."}
              </p>
            ) : (
              filteredExclusions.map((entry) => {
                const key = getExcludedLibraryGameKey(
                  entry.shop,
                  entry.objectId
                );
                const isChecked = selectedExcludedKeys.has(key);
                return (
                  <div key={key} className="settings-bulk-remove__row">
                    <div className="settings-bulk-remove__row-main">
                      <CheckboxField
                        label=""
                        checked={isChecked}
                        disabled={busy}
                        onChange={() => toggleExcludedKey(key)}
                      />
                      <span
                        className="settings-bulk-remove__row-title"
                        title={`${entry.title} (${entry.shop}:${entry.objectId})`}
                      >
                        {entry.title}
                      </span>
                    </div>

                    <div className="settings-bulk-remove__badges">
                      <span className="settings-bulk-remove__badge">
                        {entry.shop}
                      </span>
                      {entry.reason && (
                        <span className="settings-bulk-remove__badge">
                          {EXCLUSION_REASON_LABEL[entry.reason]}
                        </span>
                      )}
                      <Button
                        type="button"
                        size="small"
                        theme="outline"
                        disabled={busy}
                        onClick={() =>
                          void handleRestoreOrUnexclude([entry], true)
                        }
                      >
                        Restore
                      </Button>
                      <Button
                        type="button"
                        size="small"
                        theme="outline"
                        disabled={busy}
                        onClick={() =>
                          void handleRestoreOrUnexclude([entry], false)
                        }
                      >
                        Un-exclude
                      </Button>
                    </div>
                  </div>
                );
              })
            )}
          </div>

          <div className="settings-bulk-remove__footer">
            <span>
              {t("bulk_remove_selected_count", {
                count: selectedExcludedEntries.length,
              })}
            </span>
            <div className="settings-bulk-remove__actions">
              <Button
                type="button"
                theme="outline"
                disabled={busy || selectedExcludedEntries.length === 0}
                onClick={() =>
                  void handleRestoreOrUnexclude(selectedExcludedEntries, false)
                }
              >
                Un-exclude selected ({selectedExcludedEntries.length})
              </Button>
              <Button
                type="button"
                theme="primary"
                disabled={busy || selectedExcludedEntries.length === 0}
                onClick={() =>
                  void handleRestoreOrUnexclude(selectedExcludedEntries, true)
                }
              >
                Restore selected ({selectedExcludedEntries.length})
              </Button>
            </div>
          </div>
        </>
      )}

      <Modal
        visible={confirmOpen}
        title={t("bulk_remove_modal_title", {
          count: selectedEntries.length,
        })}
        description={`${t("bulk_remove_modal_description")} Removed titles are also added to your exclusion list so automatic syncs and importers do not bring them back.`}
        clickOutsideToClose={!removing}
        onClose={closeConfirmationModal}
      >
        <div className="settings-bulk-remove__modal-body">
          {selectedWithWarningsCount > 0 && (
            <p className="settings-bulk-remove__badge settings-bulk-remove__badge--warning">
              {t("bulk_remove_modal_warning_items", {
                count: selectedWithWarningsCount,
              })}
            </p>
          )}

          <div className="settings-bulk-remove__modal-list">
            {selectedEntries.map((entry) => (
              <div key={entry.key} className="settings-bulk-remove__modal-item">
                <span>{entry.game.title}</span>
                <span className="settings-bulk-remove__badge">
                  {entry.game.shop}
                </span>
              </div>
            ))}
          </div>

          <CheckboxField
            label={t("bulk_remove_modal_acknowledge", {
              count: selectedEntries.length,
            })}
            checked={acknowledged}
            disabled={removing}
            onChange={(event) => setAcknowledged(event.target.checked)}
          />

          <TextField
            label={t("bulk_remove_modal_confirmation", {
              phrase: expectedPhrase,
            })}
            value={confirmationText}
            disabled={removing}
            autoComplete="off"
            spellCheck={false}
            onChange={(event) => setConfirmationText(event.target.value)}
          />

          {error && (
            <p role="alert" className="settings-bulk-remove__error">
              {error}
            </p>
          )}

          <div className="settings-bulk-remove__modal-actions">
            <Button
              theme="outline"
              disabled={removing}
              onClick={closeConfirmationModal}
            >
              {t("bulk_remove_modal_cancel")}
            </Button>
            <Button
              theme="danger"
              disabled={
                removing || !acknowledged || confirmationText !== expectedPhrase
              }
              onClick={() => void handleConfirmRemoval()}
            >
              {removing
                ? t("bulk_remove_modal_removing")
                : t("bulk_remove_modal_confirm", {
                    count: selectedEntries.length,
                  })}
            </Button>
          </div>
        </div>
      </Modal>

      <Modal
        visible={exclusionConfirmAction !== null}
        title={
          exclusionConfirmAction === "exclude-steam"
            ? "Remove & exclude all Steam games?"
            : "Clear all library exclusions?"
        }
        description={
          exclusionConfirmAction === "exclude-steam"
            ? `This removes ${removableSteamCount} Steam title(s) from your library and excludes them so Steam sync will not re-add them automatically.`
            : `This clears all ${excludedGames.length} exclusion(s). Future Steam syncs, installed-game scans, or ROM imports may re-add them.`
        }
        clickOutsideToClose={!exclusionBusy}
        onClose={() => {
          if (!exclusionBusy) setExclusionConfirmAction(null);
        }}
      >
        <div className="settings-bulk-remove__modal-body">
          <div className="settings-bulk-remove__modal-actions">
            <Button
              type="button"
              theme="outline"
              disabled={exclusionBusy}
              onClick={() => setExclusionConfirmAction(null)}
            >
              Cancel
            </Button>
            <Button
              type="button"
              theme="danger"
              disabled={exclusionBusy}
              onClick={() => void handleConfirmExclusionBulkAction()}
            >
              {exclusionConfirmAction === "exclude-steam"
                ? `Exclude ${removableSteamCount} Steam game(s)`
                : "Clear all exclusions"}
            </Button>
          </div>
        </div>
      </Modal>
    </section>
  );
}
