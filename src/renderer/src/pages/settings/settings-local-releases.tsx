import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { DiffEditor, loader } from "@monaco-editor/react";
import { MONACO_VS_URL } from "@shared";
import { Button } from "@renderer/components";
import type { LocalReleaseState, ReleaseSourceFile } from "@types";
import "./settings-local-edition.scss";

loader.config({ paths: { vs: MONACO_VS_URL } });

export function SettingsLocalReleases() {
  const { t } = useTranslation("local_releases");
  const [state, setState] = useState<LocalReleaseState>();
  const [tag, setTag] = useState("");
  const [files, setFiles] = useState<ReleaseSourceFile[]>([]);
  const [selected, setSelected] = useState("");
  const [content, setContent] = useState<{
    original: string;
    modified: string;
  }>();
  const [update, setUpdate] = useState({
    phase: "idle",
    version: "",
    error: "",
  });
  const [working, setWorking] = useState(false);
  const [error, setError] = useState("");
  const request = useRef(0);
  const action = async (task: () => Promise<unknown>) => {
    setWorking(true);
    setError("");
    try {
      await task();
    } catch (e) {
      setError(String(e));
    } finally {
      setWorking(false);
    }
  };
  const refresh = async (force = false) => {
    const value = await window.electron.getLocalReleases(force);
    setState(value);
    setTag((current) => current || value.upstreamTag);
  };
  useEffect(() => {
    void action(() => refresh());
    const timer = setInterval(
      () =>
        window.electron
          .getLocalUpdateState()
          .then(setUpdate)
          .catch((e) => setError(String(e))),
      2000
    );
    return () => {
      clearInterval(timer);
    };
  }, []);
  const chooseFile = async (file: ReleaseSourceFile) => {
    const id = ++request.current;
    setSelected(file.path);
    setContent(undefined);
    setError("");
    try {
      const value = await window.electron.getReleaseSourceFile(tag, file.path);
      if (id === request.current) setContent(value);
    } catch (e) {
      if (id === request.current) setError(String(e));
    }
  };
  const compare = () =>
    action(async () => {
      const id = ++request.current;
      setContent(undefined);
      setSelected("");
      const next = await window.electron.getReleaseSourceChanges(tag);
      if (id === request.current) setFiles(next);
    });
  const release = state?.upstream.find((r) => r.tag === tag);
  return (
    <div className="settings-context-panel local-edition">
      <h2>{t("title")}</h2>
      <p>{t("description")}</p>
      {error && (
        <p role="alert" className="local-edition__error">
          {error}
        </p>
      )}
      <p>
        {t("installed", {
          version: state?.version ?? "…",
          base: state?.upstreamTag ?? "…",
        })}
      </p>
      <p className="local-edition__notice">{t("update_notice")}</p>
      <div className="local-edition__row">
        <Button
          disabled={working || update.phase === "downloading"}
          onClick={() =>
            action(async () => {
              setUpdate(await window.electron.checkLocalReleaseUpdate());
              await refresh(true);
            })
          }
        >
          {t("check")}
        </Button>
        {update.phase === "available" && (
          <Button
            onClick={() =>
              action(async () =>
                setUpdate(await window.electron.downloadLocalReleaseUpdate())
              )
            }
          >
            {t("download", { version: update.version })}
          </Button>
        )}
        {update.phase === "ready" && (
          <Button
            onClick={() =>
              action(() => window.electron.installLocalReleaseUpdate())
            }
          >
            {t("install")}
          </Button>
        )}
      </div>
      <p role="status">
        {t(`phase_${update.phase}`)} {update.error}
      </p>
      <h3>{t("custom_releases")}</h3>
      {state && !state.custom.length && <p>{t("no_custom_releases")}</p>}
      {state?.custom.slice(0, 3).map((r) => (
        <details key={r.tag}>
          <summary>{r.name}</summary>
          <pre className="local-edition__notes">{r.notes}</pre>
        </details>
      ))}
      <h3>{t("official_release")}</h3>
      <label className="local-edition__label">
        {t("choose_release")}
        <select
          value={tag}
          onChange={(e) => {
            request.current++;
            setTag(e.target.value);
            setFiles([]);
            setContent(undefined);
            setSelected("");
          }}
        >
          {state?.upstream.map((r) => (
            <option key={r.tag} value={r.tag}>
              {r.name}
            </option>
          ))}
        </select>
      </label>
      {release && (
        <details>
          <summary>{t("release_notes")}</summary>
          <pre className="local-edition__notes">{release.notes}</pre>
        </details>
      )}
      <p>{t("comparison_notice")}</p>
      <Button theme="outline" disabled={!tag || working} onClick={compare}>
        {t("see_changes")}
      </Button>
      {!!files.length && (
        <div className="local-edition__diff">
          <nav aria-label={t("changed_files")} className="local-edition__files">
            {files.map((file) => (
              <button
                type="button"
                key={file.path}
                className={file.path === selected ? "active" : ""}
                onClick={() => void chooseFile(file)}
              >
                <span className={`local-edition__status--${file.status}`}>
                  {file.status === "added"
                    ? "+"
                    : file.status === "removed"
                      ? "−"
                      : "±"}
                </span>{" "}
                {file.path}
              </button>
            ))}
          </nav>
          <section className="local-edition__editor">
            <p>{selected || t("select_file")}</p>
            {content && (
              <DiffEditor
                height="560px"
                original={content.original}
                modified={content.modified}
                theme="vs-dark"
                options={{
                  readOnly: true,
                  renderSideBySide: false,
                  minimap: { enabled: false },
                  scrollBeyondLastLine: false,
                  renderOverviewRuler: false,
                }}
              />
            )}
          </section>
        </div>
      )}
    </div>
  );
}
