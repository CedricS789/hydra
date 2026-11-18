import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useSettingsDraft } from "@renderer/context/settings/settings-draft.context";
import { useCompanionAppSettings } from "@renderer/hooks/use-companion-app-settings";
import {
  Button,
  Checkbox,
  FileExplorerModal,
  GridFocusGroup,
  HorizontalFocusGroup,
  Input,
  Modal,
  VerticalFocusGroup,
} from "../../components/common";
import { useUserPreferences } from "../../hooks";
import { SettingsSection } from "./settings-section";
import "@renderer/pages/settings/settings-companion-apps.scss";

export function CompanionAppsSettingsSection() {
  const { t } = useTranslation("settings");
  const preferences = useUserPreferences();
  const draft = useSettingsDraft();
  const vm = useCompanionAppSettings(
    preferences,
    draft?.stage ?? window.electron.updateUserPreferences
  );
  const [picker, setPicker] = useState<"executable" | "directory" | null>(null);
  if (!["win32", "linux"].includes(window.electron.platform)) return null;
  return (
    <SettingsSection
      title={t("companion_apps_title")}
      description={t("companion_apps_description")}
    >
      <div className="companion-apps">
        <Checkbox
          label={t("companion_apps_enable")}
          checked={vm.enabled}
          disabled={vm.busy}
          onChange={() => void vm.toggle()}
        />
        {!vm.apps.length && (
          <p className="companion-apps__hint">{t("companion_apps_empty")}</p>
        )}
        {vm.apps.map((app) => (
          <GridFocusGroup key={app.id} className="companion-apps__row">
            <div className="companion-apps__identity">
              <Checkbox
                label={app.name}
                checked={app.enabled}
                disabled={vm.busy}
                onChange={() => void vm.toggleApp(app.id)}
              />
              <small>{app.executablePath}</small>
            </div>
            <div className="companion-apps__actions">
              <Button
                variant="secondary"
                disabled={vm.busy}
                onClick={() => vm.edit(app)}
              >
                {t("companion_apps_edit")}
              </Button>
              <Button
                variant="secondary"
                disabled={vm.busy}
                onClick={() => void vm.remove(app.id)}
              >
                {t("companion_apps_remove")}
              </Button>
            </div>
          </GridFocusGroup>
        ))}
        <Button variant="secondary" disabled={vm.busy} onClick={vm.add}>
          {t("companion_apps_add")}
        </Button>
        {vm.error && !vm.editing && <p role="alert">{vm.error}</p>}
      </div>
      <Modal
        visible={vm.editing !== null}
        title={t("companion_apps_editor_title")}
        onClose={vm.closeEditor}
        busy={vm.busy}
        initialFocusId="companion-app-name"
      >
        {vm.editing && (
          <VerticalFocusGroup className="companion-apps companion-apps__editor">
            <Input
              focusId="companion-app-name"
              label={t("companion_apps_name")}
              placeholder=""
              value={vm.editing.name}
              onChange={(event) =>
                vm.setEditing({ ...vm.editing!, name: event.target.value })
              }
            />
            <Input
              label={t("companion_apps_executable")}
              placeholder=""
              value={vm.editing.executablePath}
              onChange={(event) =>
                vm.setEditing({
                  ...vm.editing!,
                  executablePath: event.target.value,
                })
              }
            />
            <Button variant="secondary" onClick={() => setPicker("executable")}>
              {t("companion_apps_browse_executable")}
            </Button>
            <Input
              label={t("companion_apps_arguments")}
              placeholder=""
              hint={t("companion_apps_arguments_hint")}
              value={vm.editing.arguments}
              onChange={(event) =>
                vm.setEditing({ ...vm.editing!, arguments: event.target.value })
              }
            />
            <Input
              label={t("companion_apps_directory")}
              placeholder={t("companion_apps_directory_default")}
              value={vm.editing.workingDirectory}
              onChange={(event) =>
                vm.setEditing({
                  ...vm.editing!,
                  workingDirectory: event.target.value,
                })
              }
            />
            <Button variant="secondary" onClick={() => setPicker("directory")}>
              {t("companion_apps_browse_directory")}
            </Button>
            {window.electron.platform === "win32" && (
              <>
                <Checkbox
                  label={t("companion_apps_run_as_admin")}
                  checked={vm.editing.runAsAdmin === true}
                  onChange={(checked) =>
                    vm.setEditing({ ...vm.editing!, runAsAdmin: checked })
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
            <HorizontalFocusGroup className="companion-apps__actions">
              <Button
                variant="secondary"
                disabled={vm.busy}
                onClick={vm.closeEditor}
              >
                {t("companion_apps_cancel")}
              </Button>
              <Button disabled={vm.busy} onClick={() => void vm.saveEditor()}>
                {t("companion_apps_done")}
              </Button>
            </HorizontalFocusGroup>
          </VerticalFocusGroup>
        )}
      </Modal>
      <FileExplorerModal
        visible={picker !== null}
        title={t(
          picker === "directory"
            ? "companion_apps_directory"
            : "companion_apps_executable"
        )}
        onClose={() => setPicker(null)}
        initialPath={
          (picker === "directory"
            ? vm.editing?.workingDirectory
            : vm.editing?.executablePath) || undefined
        }
        selectDirectory={picker === "directory"}
        filters={
          picker === "executable" && window.electron.platform === "win32"
            ? [
                {
                  name: t("companion_apps_executable"),
                  extensions: ["exe", "com"],
                },
              ]
            : undefined
        }
        onSelect={(value) => {
          (picker === "directory" ? vm.selectDirectory : vm.selectExecutable)(
            value
          );
          setPicker(null);
        }}
      />
    </SettingsSection>
  );
}
