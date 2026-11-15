import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button, CheckboxField } from "@renderer/components";
import type { SaveBackupVersion, SaveOperationPreview } from "@types";

interface Props {
  gameKey: string;
  destination: string;
  busy: boolean;
  beforeAction: () => Promise<unknown>;
  refresh: () => Promise<unknown>;
  reloadSettings: () => Promise<void>;
  mode?: "versions" | "advanced" | "all";
}

export function SettingsSaveManager({
  gameKey,
  destination,
  busy,
  beforeAction,
  refresh,
  reloadSettings,
  mode = "all",
}: Props) {
  const { t } = useTranslation("ludusavi");
  const [working, setWorking] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [versions, setVersions] = useState<SaveBackupVersion[]>([]);
  const [version, setVersion] = useState("");
  const [preview, setPreview] = useState<SaveOperationPreview>();
  const [understood, setUnderstood] = useState(false);
  const [advanced, setAdvanced] = useState<string>();
  const [managerOpen, setManagerOpen] = useState(false);
  const generation = useRef(0);
  const disabled = working || busy;

  useEffect(() => {
    generation.current++;
    setVersions([]);
    setVersion("");
    setPreview(undefined);
    setUnderstood(false);
    setMessage("");
  }, [gameKey, destination]);

  const action = async (task: (current: () => boolean) => Promise<void>) => {
    const id = generation.current;
    setWorking(true);
    setError("");
    setMessage("");
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

  const showPreview = (value: SaveOperationPreview) => {
    setPreview(value);
    setUnderstood(false);
  };

  const showVersions = mode === "all" || mode === "versions";
  const showAdvanced = mode === "all" || mode === "advanced";

  return (
    <>
      {error && (
        <p role="alert" className="local-edition__error">
          {error}
        </p>
      )}
      {message && (
        <p role="status" className="local-edition__status-banner">
          {message}
        </p>
      )}

      {showVersions && (
        <div className="local-edition__versions-box">
          <div className="local-edition__card-header">
            <div>
              <h4 className="local-edition__section-heading">
                {t("versions_title")}
              </h4>
              <p className="local-edition__hint">{t("versions_description")}</p>
            </div>
            <div className="local-edition__actions">
              <Button
                theme="outline"
                disabled={disabled || !gameKey}
                onClick={() =>
                  action(async (current) => {
                    const result =
                      await window.electron.listSaveBackupVersions(gameKey);
                    if (!current()) return;
                    const sorted = [...result.versions].sort((a, b) =>
                      b.when.localeCompare(a.when)
                    );
                    setVersions(sorted);
                    setVersion(sorted[0]?.name ?? "");
                    setPreview(undefined);
                    if (!sorted.length) setMessage(t("no_versions"));
                  })
                }
              >
                {t("load_versions")}
              </Button>
            </div>
          </div>

          {!!versions.length && (
            <div className="local-edition__versions-controls">
              <label className="local-edition__label">
                {t("version")}
                <select
                  value={version}
                  disabled={disabled}
                  onChange={(e) => {
                    setVersion(e.target.value);
                    setPreview(undefined);
                    setUnderstood(false);
                  }}
                >
                  {versions.map((item) => (
                    <option value={item.name} key={item.name}>
                      {new Date(item.when).toLocaleString()} · {item.name}
                      {item.locked ? ` · ${t("locked")}` : ""}
                      {item.comment ? ` · ${item.comment}` : ""}
                    </option>
                  ))}
                </select>
              </label>
              <div className="local-edition__row">
                <Button
                  disabled={disabled || !version}
                  onClick={() =>
                    action(async (current) => {
                      const result = await window.electron.previewSaveRestore(
                        gameKey,
                        version
                      );
                      if (current()) showPreview(result);
                    })
                  }
                >
                  {t("preview_restore")}
                </Button>
                <Button
                  theme="outline"
                  disabled={disabled || !version}
                  onClick={() =>
                    action(async () => {
                      setMessage(
                        (
                          await window.electron.validateSaveBackup(
                            gameKey,
                            version
                          )
                        ).message
                      );
                    })
                  }
                >
                  {t("validate_version")}
                </Button>
              </div>
            </div>
          )}
        </div>
      )}

      {showAdvanced && (
        <div className="local-edition__advanced-group">
          <div className="local-edition__subcard">
            <h4 className="local-edition__section-heading">
              {t("advanced_title")}
            </h4>
            <p className="local-edition__hint">{t("advanced_description")}</p>
            <div className="local-edition__row">
              <Button
                theme="outline"
                disabled={disabled}
                onClick={() =>
                  action(async () => {
                    setManagerOpen(true);
                    try {
                      await window.electron.openFullSaveManager(
                        gameKey || undefined
                      );
                      await reloadSettings();
                      setAdvanced(undefined);
                      setPreview(undefined);
                    } finally {
                      setManagerOpen(false);
                    }
                  })
                }
              >
                {t("open_manager")}
              </Button>
              <Button
                theme="outline"
                disabled={disabled}
                onClick={() =>
                  action(async () => {
                    await window.electron.updateSaveManifest();
                    setMessage(t("manifest_updated"));
                  })
                }
              >
                {t("update_manifest")}
              </Button>
              <Button
                theme="outline"
                disabled={disabled}
                onClick={() =>
                  action(async () => {
                    await window.electron.importStandaloneSaveConfig();
                    setAdvanced(await window.electron.getSaveAdvancedConfig());
                    setPreview(undefined);
                    setMessage(t("imported"));
                  })
                }
              >
                {t("import_standalone")}
              </Button>
              <Button
                theme="outline"
                disabled={disabled}
                onClick={() =>
                  action(async () => {
                    setAdvanced(await window.electron.getSaveAdvancedConfig());
                  })
                }
              >
                {t("load_advanced")}
              </Button>
            </div>
            {managerOpen && (
              <p role="status" className="local-edition__status-banner">
                {t("manager_open")}
              </p>
            )}
            <p className="local-edition__hint">{t("import_notice")}</p>
            {advanced !== undefined && (
              <>
                <label className="local-edition__label">
                  {t("advanced_yaml")}
                  <textarea
                    rows={14}
                    spellCheck={false}
                    value={advanced}
                    disabled={disabled}
                    onChange={(e) => setAdvanced(e.target.value)}
                  />
                </label>
                <div className="local-edition__row">
                  <Button
                    disabled={disabled}
                    onClick={() =>
                      action(async () => {
                        await window.electron.saveSaveAdvancedConfig(advanced);
                        setPreview(undefined);
                        setMessage(t("advanced_saved"));
                      })
                    }
                  >
                    {t("save_advanced")}
                  </Button>
                </div>
              </>
            )}
          </div>

          <div className="local-edition__subcard">
            <h4 className="local-edition__section-heading">
              {t("remote_title")}
            </h4>
            <p className="local-edition__hint">{t("remote_description")}</p>
            <div className="local-edition__row">
              {(["upload", "download"] as const).map((direction) => (
                <Button
                  theme="outline"
                  key={direction}
                  disabled={disabled || !gameKey}
                  onClick={() =>
                    action(async (current) => {
                      const value =
                        await window.electron.previewSaveCloudTransfer(
                          gameKey,
                          direction
                        );
                      if (current()) showPreview(value);
                    })
                  }
                >
                  {t(`preview_${direction}`)}
                </Button>
              ))}
            </div>
          </div>
        </div>
      )}

      {preview && (
        <section
          className="local-edition__subcard"
          aria-label={t("operation_preview")}
        >
          <h4 className="local-edition__section-heading">
            {t(`operation_${preview.operation}`)} · {preview.title}
          </h4>
          {!!preview.backup && <code>{preview.backup}</code>}
          <p className="local-edition__hint">
            {t("preview_count", {
              files: preview.files.length,
              registry: preview.registry.length,
            })}{" "}
            ·{" "}
            {t("preview_expires", {
              time: new Date(preview.expiresAt).toLocaleTimeString(),
            })}
          </p>
          <div className="local-edition__table-scroll">
            <table>
              <thead>
                <tr>
                  <th>{t("file_path")}</th>
                  <th>{t("change")}</th>
                  <th>{t("size_bytes")}</th>
                </tr>
              </thead>
              <tbody>
                {preview.files.slice(0, 200).map((file) => (
                  <tr key={file.path}>
                    <td>{file.path}</td>
                    <td>{file.ignored ? t("excluded") : file.change}</td>
                    <td>{file.bytes}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {preview.files.length > 200 && (
            <p className="local-edition__hint">{t("preview_limit")}</p>
          )}
          {!!preview.registry.length && (
            <pre>{preview.registry.join("\n")}</pre>
          )}
          <p className="local-edition__notice">
            {t(`confirm_${preview.operation}_notice`)}
          </p>
          <CheckboxField
            label={t("confirm_understood")}
            checked={understood}
            onChange={(e) => setUnderstood(e.target.checked)}
          />
          <div className="local-edition__row">
            <Button
              disabled={
                disabled || !understood || Date.now() >= preview.expiresAt
              }
              onClick={() =>
                action(async () => {
                  const token = preview.token;
                  setPreview(undefined);
                  setUnderstood(false);
                  const result =
                    await window.electron.confirmSaveOperation(token);
                  setMessage(
                    result.message +
                      (result.safetyPath
                        ? ` ${t("safety_location")}: ${result.safetyPath}`
                        : "")
                  );
                  setVersions([]);
                  setVersion("");
                })
              }
            >
              {t(`confirm_${preview.operation}`)}
            </Button>
            <Button
              theme="outline"
              disabled={working}
              onClick={() => {
                setPreview(undefined);
                setUnderstood(false);
              }}
            >
              {t("cancel_clear")}
            </Button>
          </div>
        </section>
      )}
    </>
  );
}
