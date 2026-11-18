import { useState } from "react";
import { useTranslation } from "react-i18next";
import type { CompanionApp, UserPreferences } from "@types";
import { validateCompanionApps } from "../../../shared/companion-apps";
import {
  useSettingsFormGuard,
  useSettingsOperationGuard,
} from "@renderer/context/settings/settings-draft.context";

const normalizeCompanionApp = (app: CompanionApp): CompanionApp => ({
  id: app.id,
  name: app.name,
  executablePath: app.executablePath,
  arguments: app.arguments,
  workingDirectory: app.workingDirectory,
  enabled: app.enabled,
  ...(app.runAsAdmin ? { runAsAdmin: true } : {}),
});

export function useCompanionAppSettings(
  preferences: UserPreferences | null,
  update: (patch: Partial<UserPreferences>) => Promise<unknown>
) {
  const { t } = useTranslation("settings");
  const apps = preferences?.companionApps ?? [];
  const [editing, setEditing] = useState<CompanionApp | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const original = editing ? apps.find((app) => app.id === editing.id) : null;
  const editorDirty = Boolean(
    editing &&
      JSON.stringify(normalizeCompanionApp(editing)) !==
        JSON.stringify(original ? normalizeCompanionApp(original) : null)
  );
  useSettingsFormGuard(
    "companion-app-editor",
    editorDirty,
    t("companion_apps_unfinished")
  );
  useSettingsOperationGuard("companion-app-save", busy);

  const change = async (patch: Partial<UserPreferences>) => {
    setError("");
    setBusy(true);
    try {
      await update(patch);
      return true;
    } catch {
      setError(t("companion_apps_save_error"));
      return false;
    } finally {
      setBusy(false);
    }
  };
  const saveEditor = async () => {
    if (!editing) return;
    const normalized = normalizeCompanionApp(editing);
    try {
      validateCompanionApps([normalized]);
      if (
        window.electron.platform === "win32" &&
        !/\.(exe|com)$/i.test(normalized.executablePath)
      )
        throw new Error("not_native_executable");
    } catch {
      setError(t("companion_apps_invalid"));
      return;
    }
    const next = original
      ? apps.map((app) => (app.id === normalized.id ? normalized : app))
      : [...apps, normalized];
    if (await change({ companionApps: next })) setEditing(null);
  };
  return {
    apps,
    editing,
    setEditing,
    error,
    busy,
    enabled: preferences?.companionAppsEnabled === true,
    closeEditor: () => {
      if (!busy) {
        setEditing(null);
        setError("");
      }
    },
    add: () => {
      setError("");
      setEditing({
        id: crypto.randomUUID(),
        name: "",
        executablePath: "",
        arguments: "",
        workingDirectory: "",
        enabled: true,
      });
    },
    edit: (app: CompanionApp) => {
      setError("");
      setEditing({ ...app });
    },
    selectExecutable: (executablePath: string) =>
      setEditing(
        (app) =>
          app && {
            ...app,
            executablePath,
            name:
              app.name || executablePath.split(/[\\/]/).pop() || executablePath,
          }
      ),
    selectDirectory: (workingDirectory: string) =>
      setEditing((app) => app && { ...app, workingDirectory }),
    toggle: () =>
      change({
        companionAppsEnabled: preferences?.companionAppsEnabled !== true,
      }),
    toggleApp: (id: string) =>
      change({
        companionApps: apps.map((app) =>
          app.id === id ? { ...app, enabled: !app.enabled } : app
        ),
      }),
    remove: (id: string) =>
      change({ companionApps: apps.filter((app) => app.id !== id) }),
    saveEditor,
  };
}
