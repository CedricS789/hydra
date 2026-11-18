import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Button,
  Checkbox,
  DropdownSelect,
  GridFocusGroup,
  Input,
} from "../../components";
import {
  useSettingsDraft,
  useSettingsOperationGuard,
} from "@renderer/context/settings/settings-draft.context";
import { useBigPictureToast, useDate, useLibrary } from "../../hooks";
import { SettingsSection } from "./settings-section";
import type {
  HydraConfigBackupState,
  HydraConfigRestorePreview,
  HydraConfigSectionId,
} from "../../../../shared/hydra-config-backup";
import { HYDRA_CONFIG_RESTORE_CONFIRMATION } from "../../../../shared/hydra-config-backup";
import { DIRECT_TORRENT_CONFIRMATION } from "../../../../shared/direct-torrent-policy";
import { saveManagerError } from "../../../../shared/save-manager-errors";

interface Props {
  busy?: boolean;
  onRestored?: () => Promise<void>;
}

export function BigPictureHydraConfigSection({
  busy: externalBusy = false,
  onRestored,
}: Readonly<Props>) {
  const { t } = useTranslation("ludusavi");
  const { formatDateTime } = useDate();
  const draft = useSettingsDraft();
  const { updateLibrary } = useLibrary();
  const { showErrorToast, showSuccessToast } = useBigPictureToast();

  const [state, setState] = useState<HydraConfigBackupState>();
  const [selectedVersion, setSelectedVersion] = useState("");
  const [selectedSnapshotId, setSelectedSnapshotId] = useState("");
  const [preview, setPreview] = useState<HydraConfigRestorePreview | null>(
    null
  );
  const [selectedSections, setSelectedSections] = useState<
    HydraConfigSectionId[]
  >([]);
  const [overwriteDestination, setOverwriteDestination] = useState(false);
  const [understood, setUnderstood] = useState(false);
  const [phrase, setPhrase] = useState("");
  const [torrentPhrase, setTorrentPhrase] = useState("");
  const [working, setWorking] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  useSettingsOperationGuard("bp-hydra-config-backup", working);

  const loadState = useCallback(async () => {
    const next = await globalThis.window.electron.getHydraConfigBackupState();
    setState(next);
    const sortedVersions = [...next.versions].sort((a, b) =>
      b.when.localeCompare(a.when)
    );
    setSelectedVersion((prev) =>
      sortedVersions.some((item) => item.name === prev)
        ? prev
        : (sortedVersions[0]?.name ?? "")
    );
    const sortedSnapshots = [...next.safetySnapshots].sort((a, b) =>
      b.when.localeCompare(a.when)
    );
    setSelectedSnapshotId((prev) =>
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
  const restoreBlockedByDraft = Boolean(draft?.hasUnsavedChanges);
  const sortedVersions = [...(state?.versions ?? [])].sort((a, b) =>
    b.when.localeCompare(a.when)
  );
  const sortedSnapshots = [...(state?.safetySnapshots ?? [])].sort((a, b) =>
    b.when.localeCompare(a.when)
  );
  const selectedSnapshot = sortedSnapshots.find(
    (item) => item.id === selectedSnapshotId
  );
  const needsTorrentConfirm = Boolean(
    preview?.directTorrentConfirmation &&
      selectedSections.includes("preferences")
  );

  const runTask = async (task: () => Promise<void>, successToast?: string) => {
    setWorking(true);
    setError("");
    setNotice("");
    try {
      await task();
      await loadState();
      if (successToast) showSuccessToast(successToast);
    } catch (err) {
      const msg = saveManagerError(err).message;
      setError(msg);
      showErrorToast(msg);
    } finally {
      setWorking(false);
    }
  };

  const openPreview = (next: HydraConfigRestorePreview) => {
    setPreview(next);
    setSelectedSections(
      next.sections.filter((item) => item.available).map((item) => item.id)
    );
    setOverwriteDestination(false);
    setUnderstood(false);
    setPhrase("");
    setTorrentPhrase("");
  };

  return (
    <SettingsSection
      title={t("config_backup_title")}
      description={t("config_backup_description")}
    >
      <div className="bp-save-backups__panel">
        <GridFocusGroup className="bp-save-backups__actions">
          <Button
            variant="primary"
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
          <Button
            variant="secondary"
            disabled={busy}
            onClick={() =>
              void runTask(async () => {
                const latest = await loadState();
                if (!latest.versions.length && !latest.safetySnapshots.length) {
                  setNotice(t("config_no_versions"));
                }
              })
            }
          >
            {t("config_load_versions")}
          </Button>
        </GridFocusGroup>

        {state?.lastBackup.lastBackupAt ? (
          <p className="bp-save-backups__hint">
            {t("config_backup_last", {
              date: formatDateTime(state.lastBackup.lastBackupAt),
              message: state.lastBackup.lastBackupMessage ?? "",
            })}
          </p>
        ) : (
          <p className="bp-save-backups__hint">{t("config_backup_never")}</p>
        )}

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
        {restoreBlockedByDraft && (
          <p role="status" className="bp-save-backups__notice">
            {t("config_unsaved_guard")}
          </p>
        )}

        {sortedVersions.length > 0 && (
          <>
            <DropdownSelect
              label={t("config_version")}
              value={selectedVersion}
              options={sortedVersions.map((item) => ({
                value: item.name,
                label: `${new Date(item.when).toLocaleString()} · ${item.name}`,
              }))}
              disabled={busy}
              onValueChange={(nextVersion) => {
                setSelectedVersion(nextVersion);
                setPreview(null);
              }}
            />
            <GridFocusGroup className="bp-save-backups__actions">
              <Button
                variant="primary"
                disabled={busy || !selectedVersion || restoreBlockedByDraft}
                onClick={() =>
                  void runTask(async () => {
                    const next =
                      await globalThis.window.electron.previewHydraConfigRestore(
                        selectedVersion
                      );
                    openPreview(next);
                  })
                }
              >
                {t("config_preview_restore")}
              </Button>
              <Button
                variant="secondary"
                disabled={busy || !selectedVersion}
                onClick={() =>
                  void runTask(async () => {
                    const res =
                      await globalThis.window.electron.validateHydraConfigBackup(
                        selectedVersion
                      );
                    setNotice(res.message);
                  })
                }
              >
                {t("config_validate_version")}
              </Button>
            </GridFocusGroup>
          </>
        )}

        {sortedSnapshots.length > 0 && (
          <>
            <DropdownSelect
              label={t("config_safety_snapshots_title")}
              value={selectedSnapshotId}
              options={sortedSnapshots.map((item) => ({
                value: item.id,
                label: `${new Date(item.when).toLocaleString()} · ${item.files} files · ${item.id.slice(0, 8)}`,
              }))}
              disabled={busy}
              onValueChange={(nextId) => {
                setSelectedSnapshotId(nextId);
                setPreview(null);
              }}
            />
            <GridFocusGroup className="bp-save-backups__actions">
              <Button
                variant="primary"
                disabled={busy || !selectedSnapshot || restoreBlockedByDraft}
                onClick={() =>
                  void runTask(async () => {
                    if (!selectedSnapshot) return;
                    const next =
                      await globalThis.window.electron.previewHydraConfigRestore(
                        selectedSnapshot.backup,
                        selectedSnapshot.id
                      );
                    openPreview(next);
                  })
                }
              >
                {t("preview_snapshot_restore")}
              </Button>
            </GridFocusGroup>
          </>
        )}

        {preview && (
          <div className="bp-save-backups__preview-box">
            <p className="bp-save-backups__notice">
              {preview.backup} · {preview.sourceHostname} (
              {preview.sourcePlatform})
            </p>
            {preview.sections.map((section) => (
              <Checkbox
                key={section.id}
                id={`bp-cfg-sec-${section.id}`}
                label={`${section.label} (${section.summary})`}
                checked={selectedSections.includes(section.id)}
                disabled={busy}
                onChange={(checked) =>
                  setSelectedSections((prev) =>
                    checked
                      ? [...prev, section.id]
                      : prev.filter((id) => id !== section.id)
                  )
                }
                block
              />
            ))}
            {preview.destinationDiffers &&
              selectedSections.includes("ludusavi") && (
                <Checkbox
                  id="bp-cfg-overwrite-dest"
                  label={t("config_overwrite_destination", {
                    destination: preview.snapshotDestination ?? "",
                  })}
                  checked={overwriteDestination}
                  disabled={busy}
                  onChange={setOverwriteDestination}
                  block
                />
              )}
            {preview.pathWarnings.length > 0 && (
              <p className="bp-save-backups__hint">
                {preview.pathWarnings.length} path warning(s) detected on this
                machine (first: {preview.pathWarnings[0].path}).
              </p>
            )}
            <Checkbox
              id="bp-cfg-understood"
              label={t("confirm_understood")}
              checked={understood}
              disabled={busy}
              onChange={setUnderstood}
              block
            />
            <Input
              label={t("config_restore_confirm_label")}
              value={phrase}
              disabled={busy}
              onChange={(event) => setPhrase(event.target.value)}
            />
            {needsTorrentConfirm && (
              <Input
                label={`Type ${DIRECT_TORRENT_CONFIRMATION}`}
                value={torrentPhrase}
                disabled={busy}
                onChange={(event) => setTorrentPhrase(event.target.value)}
              />
            )}
            <GridFocusGroup className="bp-save-backups__actions">
              <Button
                variant="primary"
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
                  void runTask(async () => {
                    const result =
                      await globalThis.window.electron.confirmHydraConfigRestore(
                        {
                          token: preview.token,
                          acknowledged: understood,
                          phrase,
                          selection: {
                            sections: selectedSections,
                            overwriteDestination,
                          },
                          ...(needsTorrentConfirm
                            ? { torrentConfirmation: torrentPhrase }
                            : {}),
                        }
                      );
                    setPreview(null);
                    setUnderstood(false);
                    setPhrase("");
                    setTorrentPhrase("");
                    setNotice(result.message);
                    await draft?.reloadSavedPreferences();
                    await updateLibrary();
                    await onRestored?.();
                  }, t("config_restore_button"))
                }
              >
                {t("config_restore_button")}
              </Button>
              <Button
                variant="secondary"
                disabled={working}
                onClick={() => {
                  setPreview(null);
                  setUnderstood(false);
                  setPhrase("");
                  setTorrentPhrase("");
                }}
              >
                {t("cancel_clear")}
              </Button>
            </GridFocusGroup>
          </div>
        )}
      </div>
    </SettingsSection>
  );
}
