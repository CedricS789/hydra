import { useContext } from "react";
import { useTranslation } from "react-i18next";
import { Button, CheckboxField, Modal, TextField } from "@renderer/components";
import { settingsContext } from "@renderer/context";
import { useSettingsDraft } from "@renderer/context/settings/settings-draft.context";
import { useAppSelector } from "@renderer/hooks";
import { useCompanionAppSettings } from "@renderer/hooks/use-companion-app-settings";
import "./settings-companion-apps.scss";

export function SettingsCompanionApps() {
  const { t } = useTranslation("settings");
  const draft = useSettingsDraft();
  const saved = useAppSelector((state) => state.userPreferences.value);
  const { updateUserPreferences } = useContext(settingsContext);
  const vm = useCompanionAppSettings(
    draft?.preferences ?? saved,
    draft?.stage ?? updateUserPreferences
  );
  const pick = async (directory = false) => {
    try {
      const { filePaths } = await window.electron.showOpenDialog({
        properties: [directory ? "openDirectory" : "openFile"],
        defaultPath:
          (directory
            ? vm.editing?.workingDirectory
            : vm.editing?.executablePath) || undefined,
        ...(!directory && window.electron.platform === "win32"
          ? {
              filters: [
                {
                  name: t("companion_apps_executable"),
                  extensions: ["exe", "com"],
                },
              ],
            }
          : {}),
      });
      if (filePaths[0])
        (directory ? vm.selectDirectory : vm.selectExecutable)(filePaths[0]);
    } catch {
      /* Cancelling or closing a picker leaves the editor unchanged. */
    }
  };

  if (!["win32", "linux"].includes(window.electron.platform)) return null;
  return (
    <div className="companion-apps">
      <p className="companion-apps__description">
        {t("companion_apps_description")}
      </p>
      <CheckboxField
        label={t("companion_apps_enable")}
        checked={vm.enabled}
        disabled={vm.busy}
        onChange={() => void vm.toggle()}
      />
      {vm.apps.length === 0 && (
        <p className="companion-apps__hint">{t("companion_apps_empty")}</p>
      )}
      {vm.apps.map((app) => (
        <div className="companion-apps__row" key={app.id}>
          <div className="companion-apps__identity">
            <CheckboxField
              label={app.name}
              checked={app.enabled}
              disabled={vm.busy}
              onChange={() => void vm.toggleApp(app.id)}
            />
            <small>{app.executablePath}</small>
          </div>
          <div className="companion-apps__actions">
            <Button
              theme="outline"
              disabled={vm.busy}
              onClick={() => vm.edit(app)}
            >
              {t("companion_apps_edit")}
            </Button>
            <Button
              theme="outline"
              disabled={vm.busy}
              onClick={() => void vm.remove(app.id)}
            >
              {t("companion_apps_remove")}
            </Button>
          </div>
        </div>
      ))}
      <Button theme="outline" disabled={vm.busy} onClick={vm.add}>
        {t("companion_apps_add")}
      </Button>
      {vm.error && !vm.editing && <p role="alert">{vm.error}</p>}
      <Modal
        visible={vm.editing !== null}
        title={t("companion_apps_editor_title")}
        onClose={vm.closeEditor}
        busy={vm.busy}
      >
        {vm.editing && (
          <form
            className="companion-apps companion-apps__editor"
            onSubmit={(event) => {
              event.preventDefault();
              void vm.saveEditor();
            }}
          >
            <TextField
              label={t("companion_apps_name")}
              value={vm.editing.name}
              onChange={(event) =>
                vm.setEditing({ ...vm.editing!, name: event.target.value })
              }
            />
            <TextField
              label={t("companion_apps_executable")}
              value={vm.editing.executablePath}
              onChange={(event) =>
                vm.setEditing({
                  ...vm.editing!,
                  executablePath: event.target.value,
                })
              }
              rightContent={
                <Button
                  type="button"
                  theme="outline"
                  onClick={() => void pick()}
                >
                  {t("companion_apps_browse")}
                </Button>
              }
            />
            <TextField
              label={t("companion_apps_arguments")}
              hint={t("companion_apps_arguments_hint")}
              value={vm.editing.arguments}
              onChange={(event) =>
                vm.setEditing({ ...vm.editing!, arguments: event.target.value })
              }
            />
            <TextField
              label={t("companion_apps_directory")}
              placeholder={t("companion_apps_directory_default")}
              value={vm.editing.workingDirectory}
              onChange={(event) =>
                vm.setEditing({
                  ...vm.editing!,
                  workingDirectory: event.target.value,
                })
              }
              rightContent={
                <Button
                  type="button"
                  theme="outline"
                  onClick={() => void pick(true)}
                >
                  {t("companion_apps_browse")}
                </Button>
              }
            />
            {window.electron.platform === "win32" && (
              <>
                <CheckboxField
                  label={t("companion_apps_run_as_admin")}
                  checked={vm.editing.runAsAdmin === true}
                  onChange={(event) =>
                    vm.setEditing({
                      ...vm.editing!,
                      runAsAdmin: event.target.checked,
                    })
                  }
                />
                <p className="companion-apps__hint">
                  {t("companion_apps_run_as_admin_hint")}
                </p>
              </>
            )}
            {vm.error && <p role="alert">{vm.error}</p>}
            <p className="companion-apps__hint">
              {t("companion_apps_save_hint")}
            </p>
            <div className="companion-apps__actions">
              <Button
                type="button"
                theme="outline"
                disabled={vm.busy}
                onClick={vm.closeEditor}
              >
                {t("companion_apps_cancel")}
              </Button>
              <Button type="submit" disabled={vm.busy}>
                {t("companion_apps_done")}
              </Button>
            </div>
          </form>
        )}
      </Modal>
    </div>
  );
}
