import { useSettingsDraft } from "@renderer/context/settings/settings-draft.context";
import { useContext, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import { Button, CheckboxField, SelectField } from "@renderer/components";
import { settingsContext } from "@renderer/context";
import { useAppSelector } from "@renderer/hooks";
import { isClassicsEnabled, isTransferGameEnabled } from "@shared";
import type { NetworkInterface, UserPreferences } from "@types";
import { SettingsDirectTorrents } from "./settings-direct-torrents";
import { SettingsGlobalTrackers } from "./settings-global-trackers";
import { SettingsBulkRemoveLibrary } from "./settings-bulk-remove-library";
import { SettingsLudusaviAdvanced } from "./settings-ludusavi-advanced";
import { SettingsSourceWebsites } from "./settings-source-websites";
import {
  getDownloadOptionInteraction,
  type DownloadOptionInteraction,
} from "../../../../shared/download-option-interaction";

import "./settings-general.scss";

const buildForm = (preferences: UserPreferences | null) => ({
  seedAfterDownloadComplete: preferences?.seedAfterDownloadComplete ?? false,
  torrentNetworkInterface: preferences?.torrentNetworkInterface ?? "",
  enableClassics: isClassicsEnabled(preferences),
  enableTransferGame: isTransferGameEnabled(preferences),
  enableSourceBrowser: preferences?.enableSourceBrowser !== false,
  downloadOptionInteraction: getDownloadOptionInteraction(preferences),
});

export function SettingsContextAdvanced() {
  const { t } = useTranslation("settings");
  const draft = useSettingsDraft();
  const { updateUserPreferences: commitUserPreferences } =
    useContext(settingsContext);
  const updateUserPreferences = draft?.stage ?? commitUserPreferences;

  const savedPreferences = useAppSelector(
    (state) => state.userPreferences.value
  );
  const userPreferences = draft?.preferences ?? savedPreferences;

  const [form, setForm] = useState(() => buildForm(userPreferences));
  const [networkInterfaces, setNetworkInterfaces] = useState<
    NetworkInterface[]
  >([]);
  const [advancedAcknowledged, setAdvancedAcknowledged] = useState(false);
  const [advancedUnlocked, setAdvancedUnlocked] = useState(false);

  useEffect(() => {
    globalThis.electron
      .getNetworkInterfaces()
      .then(setNetworkInterfaces)
      .catch(() => setNetworkInterfaces([]));
  }, []);

  useEffect(() => {
    if (!userPreferences) return;

    setForm(buildForm(userPreferences));
  }, [userPreferences]);

  const networkInterfaceOptions = useMemo(() => {
    const options = [
      { key: "default", value: "", label: t("network_interface_default") },
      ...networkInterfaces.map((networkInterface) => {
        const ipv4 = networkInterface.addresses.find(
          (address) => !address.includes(":")
        );

        return {
          key: networkInterface.name,
          value: networkInterface.name,
          label: ipv4
            ? `${networkInterface.name} (${ipv4})`
            : networkInterface.name,
        };
      }),
    ];

    const selected = form.torrentNetworkInterface;
    if (selected && !options.some((option) => option.value === selected)) {
      options.push({
        key: selected,
        value: selected,
        label: `${selected} (${t("network_interface_unavailable")})`,
      });
    }

    return options;
  }, [networkInterfaces, form.torrentNetworkInterface, t]);

  const handleChange = (values: Partial<typeof form>) => {
    setForm((prev) => ({ ...prev, ...values }));
    updateUserPreferences(values);
  };

  if (!advancedUnlocked) {
    return (
      <div className="settings-context-panel settings-context-advanced">
        <section className="settings-context-advanced__gate">
          <h3>{t("advanced_gate_title")}</h3>
          <p>{t("advanced_gate_description")}</p>
          <CheckboxField
            label={t("advanced_gate_acknowledgement")}
            checked={advancedAcknowledged}
            onChange={(event) => setAdvancedAcknowledged(event.target.checked)}
          />
          <Button
            disabled={!advancedAcknowledged}
            onClick={() => setAdvancedUnlocked(true)}
          >
            {t("advanced_gate_open")}
          </Button>
        </section>
      </div>
    );
  }

  return (
    <div className="settings-context-panel settings-context-advanced">
      <div className="settings-context-advanced__toolbar">
        <p>{t("advanced_unlocked_notice")}</p>
        <Button
          theme="outline"
          onClick={() => {
            void draft?.guardNavigation(() => {
              setAdvancedAcknowledged(false);
              setAdvancedUnlocked(false);
            });
          }}
        >
          {t("advanced_lock")}
        </Button>
      </div>

      <details className="settings-context-advanced__menu">
        <summary>
          <span>{t("advanced_download_protection_title")}</span>
          <small>{t("advanced_download_protection_description")}</small>
        </summary>
        <div className="settings-context-advanced__menu-body">
          <SettingsDirectTorrents>
            <div className="settings-general__network-interface">
              <SelectField
                label={t("network_interface")}
                value={form.torrentNetworkInterface}
                onChange={(event) =>
                  handleChange({ torrentNetworkInterface: event.target.value })
                }
                options={networkInterfaceOptions}
              />
              <small className="settings-general__network-interface-hint">
                {t("network_interface_hint")}
              </small>
            </div>

            <CheckboxField
              label={t("seed_after_download_complete")}
              checked={form.seedAfterDownloadComplete}
              onChange={() =>
                handleChange({
                  seedAfterDownloadComplete: !form.seedAfterDownloadComplete,
                })
              }
            />

            <h4>{t("global_trackers")}</h4>
            <SettingsGlobalTrackers />
          </SettingsDirectTorrents>
        </div>
      </details>

      <details className="settings-context-advanced__menu">
        <summary>
          <span>{t("features")}</span>
          <small>{t("advanced_features_description")}</small>
        </summary>
        <div className="settings-context-advanced__menu-body">
          <CheckboxField
            label={t("enable_classics")}
            checked={form.enableClassics}
            onChange={() =>
              handleChange({ enableClassics: !form.enableClassics })
            }
          />
          <CheckboxField
            label={t("enable_transfer_game")}
            checked={form.enableTransferGame}
            onChange={() =>
              handleChange({ enableTransferGame: !form.enableTransferGame })
            }
          />
          <CheckboxField
            label="Enable source website browsing"
            checked={form.enableSourceBrowser}
            onChange={() =>
              handleChange({ enableSourceBrowser: !form.enableSourceBrowser })
            }
          />
          <p>
            Shows View source in desktop and Big Picture download options.
            Turning it off closes source windows and discards unsubmitted links;
            existing downloads continue.
          </p>
          <SettingsSourceWebsites />
          <SelectField
            label="Download option interaction"
            value={form.downloadOptionInteraction}
            onChange={(event) =>
              handleChange({
                downloadOptionInteraction: event.target
                  .value as DownloadOptionInteraction,
              })
            }
            options={[
              {
                key: "native",
                value: "native",
                label:
                  "Native (default) — click a release to open download options",
              },
              {
                key: "menu",
                value: "menu",
                label: "Action menu — choose what to do first",
              },
              {
                key: "website-only",
                value: "website-only",
                label: "Website only — release cards are not clickable",
              },
            ]}
          />
          <p>
            Action menu lets you choose between viewing the website and opening
            Hydra’s download options. Native restores direct access to download
            options. Website only removes direct release selection and uses the
            source website to choose files; it requires source browsing to be
            enabled.
          </p>
        </div>
      </details>

      <details className="settings-context-advanced__menu">
        <summary>
          <span>{t("library_maintenance_title")}</span>
          <small>{t("library_maintenance_description")}</small>
        </summary>
        <div className="settings-context-advanced__menu-body">
          <SettingsBulkRemoveLibrary />
        </div>
      </details>

      <details className="settings-context-advanced__menu settings-context-advanced__menu--save-backups">
        <summary>
          <span>{t("save_backups_advanced_title", { ns: "ludusavi" })}</span>
          <small>
            {t("save_backups_advanced_description", { ns: "ludusavi" })}
          </small>
        </summary>
        <div className="settings-context-advanced__menu-body">
          <SettingsLudusaviAdvanced />
        </div>
      </details>
    </div>
  );
}
