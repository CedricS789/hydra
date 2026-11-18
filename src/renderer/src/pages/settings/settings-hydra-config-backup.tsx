import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button, CheckboxField, TextField } from "@renderer/components";
import {
  useSettingsDraft,
  useSettingsOperationGuard,
} from "@renderer/context/settings/settings-draft.context";
import { useDate, useLibrary } from "@renderer/hooks";
import type {
  HydraConfigBackupState,
  HydraConfigCloudPreview,
  HydraConfigRestorePreview,
  HydraConfigSectionId,
} from "../../../../shared/hydra-config-backup";
import { HYDRA_CONFIG_RESTORE_CONFIRMATION } from "../../../../shared/hydra-config-backup";
import { DIRECT_TORRENT_CONFIRMATION } from "../../../../shared/direct-torrent-policy";
import { saveManagerError } from "../../../../shared/save-manager-errors";

interface Props {
  mode?: "summary" | "full";
  busy?: boolean;
  onOpenAdvanced?: () => void;
  onRestored?: () => Promise<void>;
}

export function SettingsHydraConfigBackup({
  mode = "full",
  busy: externalBusy = false,
  onOpenAdvanced,
  onRestored,
}: Readonly<Props>) {
  const { t } = useTranslation("ludusavi");
  const { formatDateTime } = useDate();
  const draft = useSettingsDraft();
  const { updateLibrary } = useLibrary();

  const [state, setState] = useState<HydraConfigBackupState>();
  const [version, setVersion] = useState("");
  const [snapshotId, setSnapshotId] = useState("");
  const [lastSafetySnapshot, setLastSafetySnapshot] = useState<{
    id: string;
    backup: string;
  } | null>(null);
  const [preview, setPreview] = useState<HydraConfigRestorePreview>();
  const [selectedSections, setSelectedSections] = useState<
    HydraConfigSectionId[]
  >([]);
  const [overwriteDestination, setOverwriteDestination] = useState(false);
  const [understood, setUnderstood] = useState(false);
  const [phrase, setPhrase] = useState("");
  const [torrentPhrase, setTorrentPhrase] = useState("");
  const [cloudPreview, setCloudPreview] = useState<HydraConfigCloudPreview>();
  const [cloudUnderstood, setCloudUnderstood] = useState(false);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  useSettingsOperationGuard("hydra-config-backup", working);

  const loadState = useCallback(async () => {
    const next = await window.electron.getHydraConfigBackupState();
    setState(next);
    const sortedVersions = [...next.versions].sort((a, b) =>
      b.when.localeCompare(a.when)
    );
    setVersion((prev) =>
      sortedVersions.some((item) => item.name === prev)
        ? prev
        : (sortedVersions[0]?.name ?? "")
    );
    const sortedSnapshots = [...next.safetySnapshots].sort((a, b) =>
      b.when.localeCompare(a.when)
    );
    setSnapshotId((prev) =>
      sortedSnapshots.some((item) => item.id === prev)
        ? prev
        : (sortedSnapshots[0]?.id ?? "")
    );
    return next;
  }, []);

  useEffect(() => {
    void loadState().catch((err) => setError(String(err)));
  }, [loadState]);

  const busy = working || externalBusy;

  const runAction = async (task: () => Promise<void>) => {
    setWorking(true);
    setError("");
    setMessage("");
    try {
      await task();
      await loadState();
    } catch (err) {
      const parsed = saveManagerError(err);
      setError(parsed.message);
    } finally {
      setWorking(false);
    }
  };

  const openRestorePreview = (nextPreview: HydraConfigRestorePreview) => {
    setPreview(nextPreview);
    setCloudPreview(undefined);
    setSelectedSections(
      nextPreview.sections
        .filter((item) => item.available)
        .map((item) => item.id)
    );
    setOverwriteDestination(false);
    setUnderstood(false);
    setPhrase("");
    setTorrentPhrase("");
  };

  const selectedSnapshot = state?.safetySnapshots.find(
    (item) => item.id === snapshotId
  );
  const sortedVersions = [...(state?.versions ?? [])].sort((a, b) =>
    b.when.localeCompare(a.when)
  );
  const sortedSnapshots = [...(state?.safetySnapshots ?? [])].sort((a, b) =>
    b.when.localeCompare(a.when)
  );
  const needsTorrentConfirm = Boolean(
    preview?.directTorrentConfirmation &&
      selectedSections.includes("preferences")
  );
  const restoreBlockedByDraft = Boolean(draft?.hasUnsavedChanges);

  const renderStatus = () => {
    const last = state?.lastBackup;
    if (!last?.lastBackupAt) {
      return <p className="local-edition__hint">{t("config_backup_never")}</p>;
    }
    return (
      <p
        className={
          last.lastBackupStatus === "failed"
            ? "local-edition__error"
            : "local-edition__hint"
        }
      >
        {t("config_backup_last", {
          date: formatDateTime(last.lastBackupAt),
          message: last.lastBackupMessage ?? "",
        })}
      </p>
    );
  };

  if (mode === "summary") {
    return (
      <section className="local-edition__card">
        <div className="local-edition__card-header">
          <div>
            <h3 className="local-edition__card-title">
              {t("config_backup_title")}
            </h3>
            <p className="local-edition__card-subtitle">
              {t("config_backup_description")}
            </p>
          </div>
          <div className="local-edition__actions">
            <Button
              disabled={busy}
              onClick={() =>
                void runAction(async () => {
                  const res = await window.electron.backupHydraConfig(false);
                  setMessage(res.message);
                })
              }
            >
              {t("config_backup_now")}
            </Button>
            {onOpenAdvanced && (
              <Button theme="outline" disabled={busy} onClick={onOpenAdvanced}>
                {t("config_backup_open_recovery")}
              </Button>
            )}
          </div>
        </div>
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
        {renderStatus()}
      </section>
    );
  }

  return (
    <div className="local-edition__subcard">
      <div className="local-edition__card-header">
        <div>
          <h4 className="local-edition__section-heading">
            {t("config_backup_title")}
          </h4>
          <p className="local-edition__hint">
            {t("config_backup_description")}
          </p>
        </div>
        <div className="local-edition__actions">
          <Button
            disabled={busy}
            onClick={() =>
              void runAction(async () => {
                const res = await window.electron.backupHydraConfig(false);
                setMessage(res.message);
              })
            }
          >
            {t("config_backup_now")}
          </Button>
          <Button
            theme="outline"
            disabled={busy}
            onClick={() =>
              void runAction(async () => {
                const latest = await loadState();
                if (!latest.versions.length && !latest.safetySnapshots.length) {
                  setMessage(t("config_no_versions"));
                }
              })
            }
          >
            {t("config_load_versions")}
          </Button>
        </div>
      </div>

      {renderStatus()}

      {!!state?.excludedItems.length && (
        <details>
          <summary className="local-edition__hint">
            Excluded sensitive credentials &amp; caches (
            {state.excludedItems.length})
          </summary>
          <ul>
            {state.excludedItems.map((item) => (
              <li key={item} className="local-edition__hint">
                {item}
              </li>
            ))}
          </ul>
        </details>
      )}

      {error && (
        <p role="alert" className="local-edition__error">
          {error}
        </p>
      )}
      {message && (
        <div role="status" className="local-edition__status-banner">
          <p>{message}</p>
          {lastSafetySnapshot && (
            <div className="local-edition__row">
              <Button
                theme="outline"
                disabled={busy || restoreBlockedByDraft}
                onClick={() =>
                  void runAction(async () => {
                    const nextPreview =
                      await window.electron.previewHydraConfigRestore(
                        lastSafetySnapshot.backup,
                        lastSafetySnapshot.id
                      );
                    openRestorePreview(nextPreview);
                  })
                }
              >
                {t("undo_last_restore")}
              </Button>
            </div>
          )}
        </div>
      )}

      {restoreBlockedByDraft && (
        <p role="status" className="local-edition__safety-warning">
          {t("config_unsaved_guard")}
        </p>
      )}

      {!!sortedVersions.length && (
        <div className="local-edition__versions-controls">
          <label className="local-edition__label">
            {t("config_version")}
            <select
              value={version}
              disabled={busy}
              onChange={(e) => {
                setVersion(e.target.value);
                setPreview(undefined);
              }}
            >
              {sortedVersions.map((item) => (
                <option value={item.name} key={item.name}>
                  {new Date(item.when).toLocaleString()} · {item.name}
                  {item.locked ? ` · ${t("locked")}` : ""}
                </option>
              ))}
            </select>
          </label>
          <div className="local-edition__row">
            <Button
              disabled={busy || !version || restoreBlockedByDraft}
              onClick={() =>
                void runAction(async () => {
                  const nextPreview =
                    await window.electron.previewHydraConfigRestore(version);
                  openRestorePreview(nextPreview);
                })
              }
            >
              {t("config_preview_restore")}
            </Button>
            <Button
              theme="outline"
              disabled={busy || !version}
              onClick={() =>
                void runAction(async () => {
                  const res =
                    await window.electron.validateHydraConfigBackup(version);
                  setMessage(res.message);
                })
              }
            >
              {t("config_validate_version")}
            </Button>
          </div>
        </div>
      )}

      {!!sortedSnapshots.length && (
        <div className="local-edition__versions-controls">
          <h5 className="local-edition__section-heading">
            {t("config_safety_snapshots_title")}
          </h5>
          <p className="local-edition__hint">
            {t("config_safety_snapshots_description")}
          </p>
          <label className="local-edition__label">
            {t("safety_snapshot")}
            <select
              value={snapshotId}
              disabled={busy}
              onChange={(e) => {
                setSnapshotId(e.target.value);
                setPreview(undefined);
              }}
            >
              {sortedSnapshots.map((item) => (
                <option value={item.id} key={item.id}>
                  {new Date(item.when).toLocaleString()} · {item.files} files ·{" "}
                  {item.id.slice(0, 8)}
                </option>
              ))}
            </select>
          </label>
          <div className="local-edition__row">
            <Button
              disabled={busy || !selectedSnapshot || restoreBlockedByDraft}
              onClick={() =>
                void runAction(async () => {
                  if (!selectedSnapshot) return;
                  const nextPreview =
                    await window.electron.previewHydraConfigRestore(
                      selectedSnapshot.backup,
                      selectedSnapshot.id
                    );
                  openRestorePreview(nextPreview);
                })
              }
            >
              {t("preview_snapshot_restore")}
            </Button>
            <Button
              theme="outline"
              disabled={busy || !selectedSnapshot}
              onClick={() =>
                void runAction(async () => {
                  if (!selectedSnapshot) return;
                  const res = await window.electron.validateHydraConfigBackup(
                    selectedSnapshot.backup,
                    selectedSnapshot.id
                  );
                  setMessage(res.message);
                })
              }
            >
              {t("validate_snapshot")}
            </Button>
          </div>
        </div>
      )}

      <div className="local-edition__row">
        {(["upload", "download"] as const).map((direction) => (
          <Button
            key={direction}
            theme="outline"
            disabled={busy}
            onClick={() =>
              void runAction(async () => {
                setPreview(undefined);
                const nextCloud =
                  await window.electron.previewHydraConfigCloudTransfer(
                    direction
                  );
                setCloudPreview(nextCloud);
                setCloudUnderstood(false);
              })
            }
          >
            {t(`preview_${direction}`)}
          </Button>
        ))}
      </div>

      {cloudPreview && (
        <section className="local-edition__subcard">
          <h4 className="local-edition__section-heading">
            {t(`operation_${cloudPreview.operation}`)} · {cloudPreview.title}
          </h4>
          <p className="local-edition__hint">
            {cloudPreview.files.length} archive file(s) ·{" "}
            {t("preview_expires", {
              time: new Date(cloudPreview.expiresAt).toLocaleTimeString(),
            })}
          </p>
          <CheckboxField
            label={t("confirm_understood")}
            checked={cloudUnderstood}
            onChange={(e) => setCloudUnderstood(e.target.checked)}
          />
          <div className="local-edition__row">
            <Button
              disabled={
                busy || !cloudUnderstood || Date.now() >= cloudPreview.expiresAt
              }
              onClick={() =>
                void runAction(async () => {
                  const token = cloudPreview.token;
                  setCloudPreview(undefined);
                  setCloudUnderstood(false);
                  const res =
                    await window.electron.confirmHydraConfigCloudTransfer(
                      token
                    );
                  setMessage(res.message);
                })
              }
            >
              {t(`confirm_${cloudPreview.operation}`)}
            </Button>
            <Button
              theme="outline"
              disabled={working}
              onClick={() => {
                setCloudPreview(undefined);
                setCloudUnderstood(false);
              }}
            >
              {t("cancel_clear")}
            </Button>
          </div>
        </section>
      )}

      {preview && (
        <section
          className="local-edition__subcard"
          aria-label={t("operation_preview")}
        >
          <h4 className="local-edition__section-heading">
            {t("config_preview_restore")} · {preview.backup}
            {preview.snapshotId ? ` · ${t("safety_snapshot")}` : ""}
          </h4>
          <p className="local-edition__hint">
            Exported {formatDateTime(preview.exportedAt)} from{" "}
            {preview.sourceHostname} ({preview.sourcePlatform}, v
            {preview.sourceAppVersion}) ·{" "}
            {t("preview_expires", {
              time: new Date(preview.expiresAt).toLocaleTimeString(),
            })}
          </p>

          <div>
            {preview.sections.map((section) => (
              <div key={section.id} style={{ marginBottom: "8px" }}>
                <CheckboxField
                  label={`${section.label} — ${section.summary}`}
                  checked={selectedSections.includes(section.id)}
                  disabled={busy}
                  onChange={(e) => {
                    setSelectedSections((prev) =>
                      e.target.checked
                        ? [...prev, section.id]
                        : prev.filter((id) => id !== section.id)
                    );
                  }}
                />
                {!!section.details.length && (
                  <ul style={{ margin: "2px 0 6px 26px" }}>
                    {section.details.slice(0, 8).map((detail) => (
                      <li key={detail} className="local-edition__hint">
                        {detail}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            ))}
          </div>

          {preview.destinationDiffers &&
            selectedSections.includes("ludusavi") && (
              <div className="local-edition__safety-warning" role="status">
                <CheckboxField
                  label={t("config_overwrite_destination", {
                    destination: preview.snapshotDestination ?? "",
                  })}
                  checked={overwriteDestination}
                  disabled={busy}
                  onChange={(e) => setOverwriteDestination(e.target.checked)}
                />
                {!overwriteDestination && (
                  <p className="local-edition__hint">
                    {t("config_keep_destination", {
                      destination: preview.currentDestination,
                    })}
                  </p>
                )}
              </div>
            )}

          {!!preview.pathWarnings.length && (
            <div className="local-edition__safety-warning" role="status">
              <p>
                Some paths in this snapshot do not exist on this machine (or
                came from another OS):
              </p>
              <ul>
                {preview.pathWarnings.slice(0, 10).map((warning) => (
                  <li key={`${warning.section}:${warning.path}`}>
                    {warning.label}: <code>{warning.path}</code> (
                    {warning.reason})
                  </li>
                ))}
              </ul>
            </div>
          )}

          <CheckboxField
            label={t("confirm_understood")}
            checked={understood}
            disabled={busy}
            onChange={(e) => setUnderstood(e.target.checked)}
          />

          <TextField
            label={t("config_restore_confirm_label")}
            value={phrase}
            disabled={busy}
            onChange={(e) => setPhrase(e.target.value)}
          />

          {needsTorrentConfirm && (
            <TextField
              label={`Type ${DIRECT_TORRENT_CONFIRMATION} to restore direct peer-to-peer torrent permission`}
              value={torrentPhrase}
              disabled={busy}
              onChange={(e) => setTorrentPhrase(e.target.value)}
            />
          )}

          <div className="local-edition__row">
            <Button
              disabled={
                busy ||
                restoreBlockedByDraft ||
                !selectedSections.length ||
                !understood ||
                phrase !== HYDRA_CONFIG_RESTORE_CONFIRMATION ||
                (needsTorrentConfirm &&
                  torrentPhrase !== DIRECT_TORRENT_CONFIRMATION) ||
                Date.now() >= preview.expiresAt
              }
              onClick={() =>
                void runAction(async () => {
                  const token = preview.token;
                  const result =
                    await window.electron.confirmHydraConfigRestore({
                      token,
                      acknowledged: understood,
                      phrase,
                      selection: {
                        sections: selectedSections,
                        overwriteDestination,
                      },
                      ...(needsTorrentConfirm
                        ? { torrentConfirmation: torrentPhrase }
                        : {}),
                    });
                  setPreview(undefined);
                  setUnderstood(false);
                  setPhrase("");
                  setTorrentPhrase("");
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
                  await draft?.reloadSavedPreferences();
                  await updateLibrary();
                  await onRestored?.();
                })
              }
            >
              {t("config_restore_button")}
            </Button>
            <Button
              theme="outline"
              disabled={working}
              onClick={() => {
                setPreview(undefined);
                setUnderstood(false);
                setPhrase("");
                setTorrentPhrase("");
              }}
            >
              {t("cancel_clear")}
            </Button>
          </div>
        </section>
      )}
    </div>
  );
}
