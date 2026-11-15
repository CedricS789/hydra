import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button, TextField } from "@renderer/components";
import type { DetectedSaveGame, LudusaviLocalState } from "@types";

interface Props {
  games: LudusaviLocalState["games"];
  busy: boolean;
  destination: string;
  beforeAction: () => Promise<unknown>;
  refresh: () => Promise<unknown>;
  onAdded: (key: string) => Promise<void>;
}

type StatusFilter = "all" | "unmatched" | "matched";

export function SettingsSaveDiscovery({
  games,
  busy,
  destination,
  beforeAction,
  refresh,
  onAdded,
}: Props) {
  const { t } = useTranslation("ludusavi");
  const [entries, setEntries] = useState<DetectedSaveGame[]>([]);
  const [selected, setSelected] = useState<DetectedSaveGame>();
  const [target, setTarget] = useState("");
  const [executable, setExecutable] = useState("");
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [working, setWorking] = useState(false);
  const [bulkProgress, setBulkProgress] = useState<{
    current: number;
    total: number;
  } | null>(null);
  const [brokenImages, setBrokenImages] = useState<Record<string, boolean>>({});
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const generation = useRef(0);
  const disabled = working || busy;

  useEffect(() => {
    generation.current++;
    setEntries([]);
    setSelected(undefined);
    setNotice("");
  }, [destination]);

  const isInLibrary = (entry: DetectedSaveGame) =>
    Boolean(
      (entry.matchedGameKey &&
        games.some((game) => game.key === entry.matchedGameKey)) ||
        entry.matchingGameKeys.some((key) =>
          games.some((game) => game.key === key)
        )
    );

  const action = async (task: (current: () => boolean) => Promise<void>) => {
    const id = generation.current;
    setWorking(true);
    setError("");
    setNotice("");
    try {
      await beforeAction();
      await task(() => id === generation.current);
      await refresh();
    } catch (e) {
      setError(String(e));
    } finally {
      setWorking(false);
      setBulkProgress(null);
    }
  };

  const handleQuickAdd = (entry: DetectedSaveGame) =>
    action(async () => {
      const result = await window.electron.addDetectedSaveGame({
        entryId: entry.id,
      });
      await onAdded(result.gameKey);
      setEntries((items) =>
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
      if (selected?.id === entry.id) setSelected(undefined);
      setNotice(t("detected_added", { title: result.title }));
    });

  const unmatchedEntries = entries.filter((entry) => !isInLibrary(entry));
  const matchedEntries = entries.filter((entry) => isInLibrary(entry));

  const handleAddAll = () => {
    if (!unmatchedEntries.length) return;
    action(async (current) => {
      let lastKey = "";
      let addedCount = 0;
      const toAdd = [...unmatchedEntries];
      try {
        for (let i = 0; i < toAdd.length; i++) {
          if (!current()) return;
          const item = toAdd[i];
          setBulkProgress({ current: i + 1, total: toAdd.length });
          const result = await window.electron.addDetectedSaveGame({
            entryId: item.id,
          });
          lastKey = result.gameKey;
          addedCount++;
          setEntries((prev) =>
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
      } finally {
        // Persist partial progress in the UI even if a later entry fails.
        if (lastKey) await onAdded(lastKey);
      }
      setSelected(undefined);
      setNotice(t("detected_added_all", { count: addedCount }));
    });
  };

  const targetGame = games.find((game) => game.key === target);
  const filtered = entries.filter((entry) => {
    if (
      query.trim() &&
      !entry.title.toLowerCase().includes(query.trim().toLowerCase())
    ) {
      return false;
    }
    if (statusFilter === "unmatched") return !isInLibrary(entry);
    if (statusFilter === "matched") return isInLibrary(entry);
    return true;
  });

  const getStoreBadge = (entry: DetectedSaveGame) => {
    if (entry.steamId || entry.matchedShop === "steam") {
      const id = entry.steamId ?? entry.matchedObjectId ?? "";
      return {
        cls: "steam",
        label: id ? t("badge_steam", { id }) : "Steam",
      };
    }
    if (entry.matchedShop === "epic") {
      return { cls: "epic", label: t("badge_epic") };
    }
    if (entry.matchedShop === "launchbox") {
      return { cls: "launchbox", label: t("badge_launchbox") };
    }
    return { cls: "custom", label: t("badge_custom") };
  };

  return (
    <section className="local-edition__card" aria-label={t("discovery_title")}>
      <div className="local-edition__card-header">
        <div>
          <h3 className="local-edition__card-title">{t("discovery_title")}</h3>
          <p className="local-edition__card-subtitle">
            {t("discovery_description")}
          </p>
        </div>
        <div className="local-edition__actions">
          {(["saves", "backups"] as const).map((source) => (
            <Button
              theme="outline"
              key={source}
              disabled={disabled}
              onClick={() =>
                action(async (current) => {
                  const value =
                    await window.electron.scanDetectedSaveGames(source);
                  if (!current()) return;
                  setEntries(value);
                  setSelected(undefined);
                  setQuery("");
                  setStatusFilter("all");
                  setNotice(t("discovery_count", { count: value.length }));
                })
              }
            >
              {t(`discover_${source}`)}
            </Button>
          ))}
          {unmatchedEntries.length > 0 && (
            <Button disabled={disabled} onClick={handleAddAll}>
              {bulkProgress
                ? t("adding_all_detected", bulkProgress)
                : t("add_all_detected", { count: unmatchedEntries.length })}
            </Button>
          )}
        </div>
      </div>

      {error && (
        <p role="alert" className="local-edition__error">
          {error}
        </p>
      )}
      {notice && (
        <p role="status" className="local-edition__status-banner">
          {notice}
        </p>
      )}
      {working && !bulkProgress && (
        <p role="status" className="local-edition__status-banner">
          {t("discovery_working")}
        </p>
      )}

      {!!entries.length && (
        <>
          <div className="local-edition__discovery-toolbar">
            <div className="local-edition__filter-pills">
              {(
                [
                  ["all", t("filter_all", { count: entries.length })],
                  [
                    "unmatched",
                    t("filter_unmatched", { count: unmatchedEntries.length }),
                  ],
                  [
                    "matched",
                    t("filter_matched", { count: matchedEntries.length }),
                  ],
                ] as const
              ).map(([key, label]) => (
                <button
                  key={key}
                  type="button"
                  className={`local-edition__pill ${
                    statusFilter === key ? "local-edition__pill--active" : ""
                  }`}
                  onClick={() => setStatusFilter(key)}
                >
                  {label}
                </button>
              ))}
            </div>
            <div className="local-edition__search-box">
              <TextField
                placeholder={t("filter_detected")}
                value={query}
                onChange={(event) => setQuery(event.target.value)}
              />
            </div>
          </div>

          <div className="local-edition__discovery-list">
            {filtered.slice(0, 100).map((entry) => {
              const inLibrary = isInLibrary(entry);
              const badge = getStoreBadge(entry);
              const isExpanded = selected?.id === entry.id;
              const thumbUrl = entry.coverImageUrl || entry.iconUrl;
              const showImage = Boolean(thumbUrl && !brokenImages[entry.id]);

              return (
                <div
                  key={entry.id}
                  className={`local-edition__discovery-item ${
                    inLibrary ? "local-edition__discovery-item--matched" : ""
                  }`}
                >
                  <div className="local-edition__discovery-row">
                    <div className="local-edition__thumb">
                      {showImage ? (
                        <img
                          src={thumbUrl!}
                          alt=""
                          loading="lazy"
                          onError={() =>
                            setBrokenImages((prev) => ({
                              ...prev,
                              [entry.id]: true,
                            }))
                          }
                        />
                      ) : (
                        <span>
                          {entry.title.trim().charAt(0).toUpperCase() || "?"}
                        </span>
                      )}
                    </div>

                    <div className="local-edition__discovery-meta">
                      <div className="local-edition__discovery-title-row">
                        <span className="local-edition__discovery-title">
                          {entry.title}
                        </span>
                        <span
                          className={`local-edition__badge local-edition__badge--${badge.cls}`}
                        >
                          {badge.label}
                        </span>
                        <span
                          className={`local-edition__badge ${
                            inLibrary
                              ? "local-edition__badge--library"
                              : "local-edition__badge--unmatched"
                          }`}
                        >
                          {inLibrary
                            ? t("already_in_library")
                            : t("not_in_library")}
                        </span>
                      </div>
                      <span className="local-edition__discovery-sub">
                        {entry.source === "backups"
                          ? t("detected_versions", { count: entry.versions })
                          : t("preview_count", {
                              files: entry.files,
                              registry: entry.registryKeys,
                            })}
                      </span>
                    </div>

                    <div className="local-edition__discovery-actions">
                      {!inLibrary && (
                        <Button
                          disabled={disabled}
                          onClick={() => handleQuickAdd(entry)}
                        >
                          {t("add_detected")}
                        </Button>
                      )}
                      <Button
                        theme="outline"
                        disabled={disabled}
                        onClick={() => {
                          if (isExpanded) {
                            setSelected(undefined);
                            return;
                          }
                          setSelected(entry);
                          setTarget(
                            entry.matchedGameKey ??
                              (entry.matchingGameKeys.length === 1
                                ? entry.matchingGameKeys[0]
                                : "")
                          );
                          setExecutable("");
                          setError("");
                        }}
                      >
                        {isExpanded ? t("hide_options") : t("review_detected")}
                      </Button>
                    </div>
                  </div>

                  {isExpanded && (
                    <div className="local-edition__discovery-drawer">
                      {!!selected.filePaths.length && (
                        <details className="local-edition__subdrawer">
                          <summary>{t("detected_paths")}</summary>
                          <pre>{selected.filePaths.join("\n")}</pre>
                        </details>
                      )}
                      <div className="local-edition__grid-2">
                        <label className="local-edition__label">
                          {t("library_destination")}
                          <select
                            value={target}
                            disabled={disabled}
                            onChange={(event) => {
                              setTarget(event.target.value);
                              setExecutable("");
                            }}
                          >
                            <option value="">{t("new_library_entry")}</option>
                            {games.map((game) => (
                              <option key={game.key} value={game.key}>
                                {game.title} · {game.key}
                              </option>
                            ))}
                          </select>
                        </label>

                        {targetGame?.executablePath ? (
                          <div className="local-edition__label">
                            <span>{t("existing_executable")}</span>
                            <code>{targetGame.executablePath}</code>
                          </div>
                        ) : (
                          <TextField
                            label={t("detected_executable")}
                            value={executable}
                            onChange={(event) =>
                              setExecutable(event.target.value)
                            }
                            rightContent={
                              <Button
                                theme="outline"
                                disabled={disabled}
                                onClick={async () => {
                                  try {
                                    const result =
                                      await window.electron.showOpenDialog({
                                        properties: ["openFile"],
                                        filters: [
                                          {
                                            name: t("game_executable"),
                                            extensions: ["exe"],
                                          },
                                        ],
                                      });
                                    if (result.filePaths[0])
                                      setExecutable(result.filePaths[0]);
                                  } catch (e) {
                                    setError(String(e));
                                  }
                                }}
                              >
                                {t("browse")}
                              </Button>
                            }
                          />
                        )}
                      </div>

                      <p className="local-edition__hint">
                        {target
                          ? t("link_preserves_game")
                          : selected.steamId ||
                              (selected.matchedShop &&
                                selected.matchedShop !== "custom")
                            ? t("detected_store_entry")
                            : t("detected_custom_entry")}
                      </p>

                      <div className="local-edition__row">
                        <Button
                          disabled={disabled}
                          onClick={() =>
                            action(async () => {
                              const result =
                                await window.electron.addDetectedSaveGame({
                                  entryId: selected.id,
                                  targetGameKey: target || undefined,
                                  executablePath:
                                    executable.trim() || undefined,
                                });
                              await onAdded(result.gameKey);
                              setEntries((items) =>
                                items.map((item) =>
                                  item.id === selected.id
                                    ? {
                                        ...item,
                                        matchedGameKey: result.gameKey,
                                        matchingGameKeys: [result.gameKey],
                                      }
                                    : item
                                )
                              );
                              setSelected(undefined);
                              setNotice(
                                t("detected_added", { title: result.title })
                              );
                            })
                          }
                        >
                          {target ? t("link_detected") : t("add_detected")}
                        </Button>
                        <Button
                          theme="outline"
                          disabled={working}
                          onClick={() => setSelected(undefined)}
                        >
                          {t("cancel_clear")}
                        </Button>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
          {filtered.length > 100 && (
            <p className="local-edition__hint">{t("discovery_limit")}</p>
          )}
        </>
      )}
    </section>
  );
}
