import { useContext, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import { CheckboxField, SelectField } from "@renderer/components";
import { settingsContext } from "@renderer/context";
import { useAppSelector } from "@renderer/hooks";
import type { NetworkInterface, UserPreferences } from "@types";
import { SettingsDirectTorrents } from "./settings-direct-torrents";
import { SettingsGlobalTrackers } from "./settings-global-trackers";
import { SettingsBulkRemoveLibrary } from "./settings-bulk-remove-library";

import "./settings-general.scss";

const buildForm = (preferences: UserPreferences | null) => ({
  seedAfterDownloadComplete: preferences?.seedAfterDownloadComplete ?? false,
  torrentNetworkInterface: preferences?.torrentNetworkInterface ?? "",
});

export function SettingsContextAdvanced() {
  const { t } = useTranslation("settings");
  const { updateUserPreferences } = useContext(settingsContext);

  const userPreferences = useAppSelector(
    (state) => state.userPreferences.value
  );

  const [form, setForm] = useState(() => buildForm(userPreferences));
  const [networkInterfaces, setNetworkInterfaces] = useState<
    NetworkInterface[]
  >([]);

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

  return (
    <div className="settings-context-panel">
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

      <SettingsBulkRemoveLibrary />
    </div>
  );
}
