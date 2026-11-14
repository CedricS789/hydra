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
  const [working, setWorking] = useState(false);
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
    }
  };
  const targetGame = games.find((game) => game.key === target);
  const filtered = entries.filter((entry) =>
    entry.title.toLowerCase().includes(query.toLowerCase())
  );

  return (
    <section
      className="local-edition__result"
      aria-label={t("discovery_title")}
    >
      <h3>{t("discovery_title")}</h3>
      <p>{t("discovery_description")}</p>
      {error && (
        <p role="alert" className="local-edition__error">
          {error}
        </p>
      )}
      {notice && <p role="status">{notice}</p>}
      <div className="local-edition__row">
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
                setNotice(t("discovery_count", { count: value.length }));
              })
            }
          >
            {t(`discover_${source}`)}
          </Button>
        ))}
      </div>
      {working && <p role="status">{t("discovery_working")}</p>}
      {!!entries.length && (
        <>
          <TextField
            label={t("filter_detected")}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
          <div className="local-edition__table-scroll">
            <table>
              <thead>
                <tr>
                  <th>{t("game")}</th>
                  <th>{t("detected_data")}</th>
                  <th>{t("library_status")}</th>
                  <th>{t("actions")}</th>
                </tr>
              </thead>
              <tbody>
                {filtered.slice(0, 100).map((entry) => (
                  <tr key={entry.id}>
                    <td>
                      {entry.title}
                      {entry.steamId && <p>Steam · {entry.steamId}</p>}
                    </td>
                    <td>
                      {entry.source === "backups"
                        ? t("detected_versions", { count: entry.versions })
                        : t("preview_count", {
                            files: entry.files,
                            registry: entry.registryKeys,
                          })}
                    </td>
                    <td>
                      {entry.matchingGameKeys.some((key) =>
                        games.some((game) => game.key === key)
                      )
                        ? t("already_in_library")
                        : t("not_in_library")}
                    </td>
                    <td>
                      <Button
                        theme="outline"
                        disabled={disabled}
                        onClick={() => {
                          setSelected(entry);
                          setTarget(
                            entry.matchingGameKeys.length === 1
                              ? entry.matchingGameKeys[0]
                              : ""
                          );
                          setExecutable("");
                          setError("");
                        }}
                      >
                        {t("review_detected")}
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {filtered.length > 100 && <p>{t("discovery_limit")}</p>}
        </>
      )}
      {selected && (
        <div className="local-edition__notice">
          <h4>{selected.title}</h4>
          {!!selected.filePaths.length && (
            <details>
              <summary>{t("detected_paths")}</summary>
              <pre>{selected.filePaths.join("\n")}</pre>
            </details>
          )}
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
          <p>
            {target
              ? t("link_preserves_game")
              : selected.steamId
                ? t("detected_store_entry")
                : t("detected_custom_entry")}
          </p>
          {targetGame?.executablePath ? (
            <p>
              {t("existing_executable")}:{" "}
              <code>{targetGame.executablePath}</code>
            </p>
          ) : (
            <>
              <TextField
                label={t("detected_executable")}
                value={executable}
                onChange={(event) => setExecutable(event.target.value)}
                rightContent={
                  <Button
                    theme="outline"
                    disabled={disabled}
                    onClick={async () => {
                      try {
                        const result = await window.electron.showOpenDialog({
                          properties: ["openFile"],
                          filters: [
                            { name: t("game_executable"), extensions: ["exe"] },
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
              <p>{t("executable_discovery_notice")}</p>
            </>
          )}
          <div className="local-edition__row">
            <Button
              disabled={
                disabled || (!target && !selected.steamId && !executable.trim())
              }
              onClick={() =>
                action(async () => {
                  const result = await window.electron.addDetectedSaveGame({
                    entryId: selected.id,
                    targetGameKey: target || undefined,
                    executablePath: executable.trim() || undefined,
                  });
                  await onAdded(result.gameKey);
                  setEntries((items) =>
                    items.map((item) =>
                      item.id === selected.id
                        ? { ...item, matchingGameKeys: [result.gameKey] }
                        : item
                    )
                  );
                  setSelected(undefined);
                  setNotice(
                    t("detected_added", { title: result.title }) +
                      (result.executableRequired
                        ? ` ${t("missing_executable")}`
                        : "")
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
    </section>
  );
}
