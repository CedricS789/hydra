import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button, CheckboxField, Modal, TextField } from "@renderer/components";
import { useGameCollections, useLibrary, useToast } from "@renderer/hooks";
import {
  formatBulkLibraryRemovalConfirmation,
  getBulkLibraryRemovalBlockReason,
  isLibraryGameDownloading,
  type BulkLibraryRemovalBlockReason,
  type BulkLibraryRemovalResult,
} from "@shared";
import type { LibraryGame } from "@types";
import "./settings-bulk-remove-library.scss";

type LibraryFilter =
  | "all"
  | "no_executable"
  | "no_playtime"
  | "with_executable"
  | "hidden";

interface DecoratedLibraryEntry {
  key: string;
  game: LibraryGame;
  blockReason: BulkLibraryRemovalBlockReason | null;
  hasExecutable: boolean;
  playtimeMinutes: number;
}

const getGameKey = (game: Pick<LibraryGame, "shop" | "objectId">) =>
  `${game.shop}:${game.objectId}`;

const formatPlaytimeShort = (minutes: number): string => {
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h`;
};

export function SettingsBulkRemoveLibrary() {
  const { t } = useTranslation("settings");
  const { library, updateLibrary } = useLibrary();
  const { loadCollections } = useGameCollections();
  const { showSuccessToast, showErrorToast } = useToast();

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

  const entries = useMemo<DecoratedLibraryEntry[]>(() => {
    return [...library]
      .filter((game) => !game.isDeleted)
      .sort((a, b) => a.title.localeCompare(b.title))
      .map((game) => {
        const key = getGameKey(game);
        const isRunning = runningIds.has(game.id) || runningIds.has(key);
        const isDownloading = isLibraryGameDownloading(game);
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

  const filteredEntries = useMemo(() => {
    const query = search.trim().toLowerCase();
    return entries.filter((entry) => {
      if (query && !entry.game.title.toLowerCase().includes(query)) {
        return false;
      }
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
    try {
      const targets = selectedEntries.map((entry) => ({
        shop: entry.game.shop,
        objectId: entry.game.objectId,
      }));
      const result = await window.electron.bulkRemoveGamesFromLibrary(
        targets,
        confirmationText
      );
      setLastResult(result);

      for (const item of result.removed) {
        try {
          window.dispatchEvent(
            new CustomEvent("hydra:game-removed-from-library", {
              detail: { shop: item.shop, objectId: item.objectId },
            })
          );
        } catch {
          /* empty */
        }
      }

      if (result.removed.length > 0) {
        showSuccessToast(
          t("bulk_remove_success_toast", { count: result.removed.length })
        );
      } else if (result.failed.length > 0) {
        showErrorToast(t("bulk_remove_failed_toast"));
      }

      setConfirmOpen(false);
      setAcknowledged(false);
      setConfirmationText("");
      setSelectedKeys(new Set());
    } catch (caughtError) {
      const message =
        caughtError instanceof Error
          ? caughtError.message
          : String(caughtError);
      setError(message);
      showErrorToast(message);
    } finally {
      setRemoving(false);
      await Promise.all([updateLibrary(), loadCollections()]).catch(() => {});
    }
  };

  const filters: { id: LibraryFilter; label: string; show?: boolean }[] = [
    { id: "all", label: t("bulk_remove_filter_all") },
    { id: "no_executable", label: t("bulk_remove_filter_no_executable") },
    { id: "no_playtime", label: t("bulk_remove_filter_no_playtime") },
    { id: "with_executable", label: t("bulk_remove_filter_with_executable") },
    {
      id: "hidden",
      label: t("bulk_remove_filter_hidden", { count: hiddenCount }),
      show: hiddenCount > 0,
    },
  ];

  return (
    <section className="settings-bulk-remove">
      <h3>{t("bulk_remove_title")}</h3>
      <p className="settings-bulk-remove__subtitle">
        {t("bulk_remove_description")}
      </p>

      {error && (
        <p role="alert" className="settings-bulk-remove__error">
          {error}
        </p>
      )}

      {lastResult && (
        <p role="status" className="settings-bulk-remove__result">
          {t("bulk_remove_result_summary", {
            removed: lastResult.removed.length,
            skipped: lastResult.skipped.length,
            failed: lastResult.failed.length,
          })}
        </p>
      )}

      <div className="settings-bulk-remove__controls">
        <div className="settings-bulk-remove__search">
          <TextField
            placeholder={t("bulk_remove_search_placeholder")}
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            disabled={removing}
          />
        </div>
        <Button
          theme="outline"
          disabled={removing || eligibleFilteredKeys.length === 0}
          onClick={selectAllFiltered}
        >
          {t("bulk_remove_select_visible", {
            count: eligibleFilteredKeys.length,
          })}
        </Button>
        <Button
          theme="outline"
          disabled={removing || selectedEntries.length === 0}
          onClick={clearSelection}
        >
          {t("bulk_remove_clear_selection")}
        </Button>
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
                  entry.blockReason ? "settings-bulk-remove__row--blocked" : ""
                }`}
              >
                <div className="settings-bulk-remove__row-main">
                  <CheckboxField
                    label=""
                    checked={isChecked}
                    disabled={removing || Boolean(entry.blockReason)}
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
          {t("bulk_remove_selected_count", { count: selectedEntries.length })}
        </span>
        <div className="settings-bulk-remove__actions">
          <Button
            theme="danger"
            disabled={removing || selectedEntries.length === 0}
            onClick={openConfirmationModal}
          >
            {t("bulk_remove_review_button", { count: selectedEntries.length })}
          </Button>
        </div>
      </div>

      <Modal
        visible={confirmOpen}
        title={t("bulk_remove_modal_title", {
          count: selectedEntries.length,
        })}
        description={t("bulk_remove_modal_description")}
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
    </section>
  );
}
