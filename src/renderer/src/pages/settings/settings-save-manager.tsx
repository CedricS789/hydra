import {
  useSettingsOperationGuard,
  useSettingsConfirmation,
} from "@renderer/context/settings/settings-draft.context";
import { useEffect, useRef, useState } from "react";
import { useSettingsFormGuard } from "@renderer/context/settings/settings-draft.context";
import { useTranslation } from "react-i18next";
import { Button, CheckboxField } from "@renderer/components";
import type {
  SaveBackupVersion,
  SaveOperationPreview,
  SaveSafetySnapshot,
} from "@types";
import { saveManagerError } from "../../../../shared/save-manager-errors";

interface Props {
  gameKey: string;
  gameTitle?: string;
  destination: string;
  busy: boolean;
  beforeAction: () => Promise<unknown>;
  refresh: () => Promise<unknown>;
  reloadSettings: () => Promise<void>;
  mode?: "versions" | "advanced" | "remote" | "all";
}

export function SettingsSaveManager({
  gameKey,
  gameTitle,
  destination,
  busy,
  beforeAction,
  refresh,
  reloadSettings,
  mode = "all",
}: Props) {
  const confirm = useSettingsConfirmation();
  const { t } = useTranslation("ludusavi");
  const [working, setWorking] = useState(false);
  useSettingsOperationGuard(`save-manager-${mode}`, working);
  const [error, setError] = useState("");
  const [remoteSetupNeeded, setRemoteSetupNeeded] = useState(false);
  const [message, setMessage] = useState("");
  const [versions, setVersions] = useState<SaveBackupVersion[]>([]);
  const [version, setVersion] = useState("");
  const [snapshots, setSnapshots] = useState<SaveSafetySnapshot[]>([]);
  const [snapshotId, setSnapshotId] = useState("");
  const [lastSafetySnapshot, setLastSafetySnapshot] = useState<{
    id: string;
    backup: string;
  } | null>(null);
  const [preview, setPreview] = useState<SaveOperationPreview>();
  const [understood, setUnderstood] = useState(false);
  const [advanced, setAdvanced] = useState<string>();
  const [savedAdvanced, setSavedAdvanced] = useState<string>();
  const yamlDirty = advanced !== undefined && advanced !== savedAdvanced;
  useSettingsFormGuard(
    `save-yaml-${mode}`,
    yamlDirty,
    "Advanced save configuration (YAML)"
  );
  const loadAdvanced = async () => {
    if (
      yamlDirty &&
      !(await confirm("discard", ["Unsaved YAML save rules in this editor."]))
    )
      return;
    const value = await window.electron.getSaveAdvancedConfig();
    setAdvanced(value);
    setSavedAdvanced(value);
  };
  const [managerOpen, setManagerOpen] = useState(false);
  const [pendingManagerOpen, setPendingManagerOpen] = useState<boolean | null>(
    null
  );
  const [managerAcknowledged, setManagerAcknowledged] = useState(false);
  const generation = useRef(0);
  const disabled = working || busy;

  useEffect(() => {
    generation.current++;
    setVersions([]);
    setVersion("");
    setSnapshots([]);
    setSnapshotId("");
    setLastSafetySnapshot(null);
    setPreview(undefined);
    setUnderstood(false);
    setMessage("");
  }, [gameKey, destination]);

  const action = async (task: (current: () => boolean) => Promise<void>) => {
    const id = generation.current;
    setWorking(true);
    setError("");
    setRemoteSetupNeeded(false);
    setMessage("");
    let failed = false;
    const showError = (error: unknown) => {
      const result = saveManagerError(error);
      setRemoteSetupNeeded(result.remoteSetupRequired);
      setError(
        result.remoteSetupRequired ? t("remote_setup_required") : result.message
      );
    };
    try {
      await beforeAction();
      await task(() => id === generation.current);
    } catch (e) {
      failed = true;
      showError(e);
    } finally {
      try {
        await refresh();
      } catch (e) {
        if (!failed) showError(e);
      } finally {
        setWorking(false);
      }
    }
  };

  const openManager = (remote = false) => {
    if (yamlDirty) {
      setError(
        "Save or discard the YAML edits before opening the full manager."
      );
      return;
    }
    setManagerAcknowledged(false);
    setPendingManagerOpen(remote);
  };

  const confirmOpenManager = () => {
    if (pendingManagerOpen === null || !managerAcknowledged) return;
    const remote = pendingManagerOpen;
    setPendingManagerOpen(null);
    void action(async () => {
      setManagerOpen(true);
      setPreview(undefined);
      try {
        await window.electron.openFullSaveManager(gameKey || undefined);
        await reloadSettings();
        setAdvanced(undefined);
        if (remote) setMessage(t("remote_setup_return"));
      } finally {
        setManagerOpen(false);
      }
    });
  };

  const showPreview = (value: SaveOperationPreview) => {
    setPreview(value);
    setUnderstood(false);
  };

  const showVersions = mode === "all" || mode === "versions";
  const showAdvanced = mode === "all" || mode === "advanced";
  const showRemoteTransfers = mode === "remote";

  const renderTransferButtons = () => (
    <div className="local-edition__row">
      {(["upload", "download"] as const).map((direction) => (
        <Button
          theme="outline"
          key={direction}
          disabled={disabled || !gameKey}
          onClick={() =>
            action(async (current) => {
              setPreview(undefined);
              const value = await window.electron.previewSaveCloudTransfer(
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
  );

  const loadVersionsAndSnapshots = async (
    current: () => boolean,
    silentEmpty = false
  ) => {
    const result = await window.electron.listSaveBackupVersions(gameKey);
    if (!current()) return;
    const sorted = [...result.versions].sort((a, b) =>
      b.when.localeCompare(a.when)
    );
    const sortedSnapshots = [...(result.snapshots ?? [])].sort((a, b) =>
      b.when.localeCompare(a.when)
    );
    setVersions(sorted);
    setVersion((prev) =>
      sorted.some((item) => item.name === prev) ? prev : (sorted[0]?.name ?? "")
    );
    setSnapshots(sortedSnapshots);
    setSnapshotId((prev) =>
      sortedSnapshots.some((item) => item.id === prev)
        ? prev
        : (sortedSnapshots[0]?.id ?? "")
    );
    if (!silentEmpty) {
      setPreview(undefined);
      if (!sorted.length && !sortedSnapshots.length)
        setMessage(t("no_versions"));
    }
  };

  const selectedSnapshot = snapshots.find((item) => item.id === snapshotId);

  return (
    <>
      {error && !remoteSetupNeeded && (
        <p role="alert" className="local-edition__error">
          {error}
        </p>
      )}
      {message && (
        <div role="status" className="local-edition__status-banner">
          <p>{message}</p>
          {lastSafetySnapshot && gameKey && (
            <div className="local-edition__row">
              <Button
                theme="outline"
                disabled={disabled}
                onClick={() =>
                  action(async (current) => {
                    const result = await window.electron.previewSaveRestore(
                      gameKey,
                      lastSafetySnapshot.backup,
                      lastSafetySnapshot.id
                    );
                    if (current()) showPreview(result);
                  })
                }
              >
                {t("undo_last_restore")}
              </Button>
            </div>
          )}
        </div>
      )}

      {showVersions && (
        <div className="local-edition__versions-box">
          <div className="local-edition__card-header">
            <div>
              <h4 className="local-edition__section-heading">
                {gameTitle
                  ? t("versions_title_for_game", { game: gameTitle })
                  : t("versions_title")}
              </h4>
              <p className="local-edition__hint">{t("versions_description")}</p>
            </div>
            <div className="local-edition__actions">
              <Button
                theme="outline"
                disabled={disabled || !gameKey}
                onClick={() =>
                  action(async (current) => {
                    await loadVersionsAndSnapshots(current);
                  })
                }
              >
                {t("load_versions")}
              </Button>
            </div>
          </div>
          <p className="local-edition__safety-warning">
            {t("restore_safety_warning")}
          </p>

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

          {!!snapshots.length && (
            <div className="local-edition__versions-controls">
              <h5 className="local-edition__section-heading">
                {t("safety_snapshots_title")}
              </h5>
              <p className="local-edition__hint">
                {t("safety_snapshots_description")}
              </p>
              <label className="local-edition__label">
                {t("safety_snapshot")}
                <select
                  value={snapshotId}
                  disabled={disabled}
                  onChange={(e) => {
                    setSnapshotId(e.target.value);
                    setPreview(undefined);
                    setUnderstood(false);
                  }}
                >
                  {snapshots.map((item) => (
                    <option value={item.id} key={item.id}>
                      {new Date(item.when).toLocaleString()} ·{" "}
                      {t("preview_count", {
                        files: item.files,
                        registry: item.hasRegistry ? 1 : 0,
                      })}
                      {item.hasRegistry
                        ? ` · ${t("snapshot_registry_badge")}`
                        : ""}{" "}
                      · {item.id.slice(0, 8)}
                    </option>
                  ))}
                </select>
              </label>
              <div className="local-edition__row">
                <Button
                  disabled={disabled || !selectedSnapshot}
                  onClick={() =>
                    action(async (current) => {
                      if (!selectedSnapshot) return;
                      const result = await window.electron.previewSaveRestore(
                        gameKey,
                        selectedSnapshot.backup,
                        selectedSnapshot.id
                      );
                      if (current()) showPreview(result);
                    })
                  }
                >
                  {t("preview_snapshot_restore")}
                </Button>
                <Button
                  theme="outline"
                  disabled={disabled || !selectedSnapshot}
                  onClick={() =>
                    action(async () => {
                      if (!selectedSnapshot) return;
                      setMessage(
                        (
                          await window.electron.validateSaveBackup(
                            gameKey,
                            selectedSnapshot.backup,
                            selectedSnapshot.id
                          )
                        ).message
                      );
                    })
                  }
                >
                  {t("validate_snapshot")}
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
                disabled={disabled || pendingManagerOpen !== null}
                onClick={() => openManager()}
              >
                {t("open_manager")}
              </Button>
              <Button
                theme="outline"
                disabled={disabled || pendingManagerOpen !== null}
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
                    if (
                      !(await confirm("save", [
                        "Replace advanced save rules with standalone Ludusavi settings. Existing edits in the YAML editor will be replaced. A previous configuration copy is kept.",
                      ]))
                    )
                      return;
                    await window.electron.importStandaloneSaveConfig();
                    await loadAdvanced();
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
                    await loadAdvanced();
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
            {pendingManagerOpen !== null && (
              <div className="local-edition__safety-warning" role="alert">
                <p>{t("manager_safety_warning")}</p>
                <CheckboxField
                  label={t("manager_safety_acknowledgement")}
                  checked={managerAcknowledged}
                  onChange={(event) =>
                    setManagerAcknowledged(event.target.checked)
                  }
                />
                <div className="local-edition__actions">
                  <Button
                    disabled={disabled || !managerAcknowledged}
                    onClick={confirmOpenManager}
                  >
                    {pendingManagerOpen
                      ? t("remote_setup_open")
                      : t("open_manager")}
                  </Button>
                  <Button
                    theme="outline"
                    disabled={disabled}
                    onClick={() => setPendingManagerOpen(null)}
                  >
                    {t("cancel_clear")}
                  </Button>
                </div>
              </div>
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
                        if (
                          !(await confirm("save", [
                            "Apply edited Ludusavi YAML rules. These can change file and registry matching, exclusions, redirects, and recovery behavior. Review every changed rule before proceeding.",
                          ]))
                        )
                          return;
                        if (
                          (await window.electron.getSaveAdvancedConfig()) !==
                          savedAdvanced
                        )
                          throw new Error(
                            "Save rules changed elsewhere. Reload the configuration and review the current rules before saving."
                          );
                        await window.electron.saveSaveAdvancedConfig(advanced);
                        setSavedAdvanced(advanced);
                        setPreview(undefined);
                        setMessage(t("advanced_saved"));
                      })
                    }
                  >
                    {t("save_advanced")}
                  </Button>
                  <Button
                    theme="outline"
                    disabled={disabled || !yamlDirty}
                    onClick={async () => {
                      if (
                        await confirm("discard", [
                          "Unsaved YAML save rules in this editor.",
                        ])
                      )
                        setAdvanced(savedAdvanced);
                    }}
                  >
                    Discard YAML edits
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
            <p className="local-edition__hint">
              {t("remote_folder_sync_hint")}
            </p>
            {remoteSetupNeeded && (
              <p role="alert" className="local-edition__error">
                {error}
              </p>
            )}
            <ol className="local-edition__setup-steps">
              <li>{t("remote_setup_step_open")}</li>
              <li>{t("remote_setup_step_configure")}</li>
              <li>{t("remote_setup_step_return")}</li>
            </ol>
            <div className="local-edition__row">
              <Button disabled={disabled} onClick={() => openManager(true)}>
                {t("remote_setup_open")}
              </Button>
              <Button
                theme="outline"
                onClick={() =>
                  window.electron.openExternal(
                    "https://github.com/mtkennerly/ludusavi/blob/v0.31.0/docs/help/cloud-backup.md"
                  )
                }
              >
                {t("remote_setup_help")}
              </Button>
            </div>
            {gameKey ? (
              <>
                {gameTitle && (
                  <p className="local-edition__hint">
                    {t("selected_game_banner_label")}:{" "}
                    <strong>{gameTitle}</strong>
                  </p>
                )}
                {renderTransferButtons()}
              </>
            ) : (
              <p className="local-edition__hint">{t("remote_card_hint")}</p>
            )}
          </div>
        </div>
      )}

      {showRemoteTransfers && renderTransferButtons()}

      {preview && (
        <section
          className="local-edition__subcard"
          aria-label={t("operation_preview")}
        >
          <h4 className="local-edition__section-heading">
            {t(`operation_${preview.operation}`)} · {preview.title}
            {preview.snapshotId ? ` · ${t("safety_snapshot")}` : ""}
          </h4>
          {!!preview.backup && (
            <code>
              {preview.snapshotId
                ? `${preview.snapshotId}/${preview.backup}`
                : preview.backup}
            </code>
          )}
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
                action(async (current) => {
                  const token = preview.token;
                  setPreview(undefined);
                  setUnderstood(false);
                  const result =
                    await window.electron.confirmSaveOperation(token);
                  setLastSafetySnapshot(
                    result.safetySnapshotId && result.safetyBackupName
                      ? {
                          id: result.safetySnapshotId,
                          backup: result.safetyBackupName,
                        }
                      : null
                  );
                  setMessage(
                    result.message +
                      (result.safetyPath
                        ? ` ${t("safety_location")}: ${result.safetyPath}`
                        : "")
                  );
                  await loadVersionsAndSnapshots(current, true);
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
