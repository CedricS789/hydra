import { withResetDefaults } from "../../../../shared/settings-reset";
import { useSettingsDraft } from "@renderer/context/settings/settings-draft.context";
import { useContext, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useSearchParams } from "react-router-dom";

import { Button, CheckboxField, SelectField } from "@renderer/components";
import { settingsContext } from "@renderer/context";
import { useAppSelector } from "@renderer/hooks";
import {
  areAllDangerZonePreferencesDisabled,
  areAllDangerZonePreferencesEnabled,
  areAllSocialPreferencesDisabled,
  buildDisableAllDangerZonePreferencesPatch,
  buildDisableAllSocialPreferencesPatch,
  buildEnableAllDangerZonePreferencesPatch,
  buildSocialPreferenceUpdatePatch,
  DANGER_ZONE_ACTION_CONTROLS,
  DANGER_ZONE_MASTER_CONTROL,
  isClassicsEnabled,
  isHydraAchievementPointsEnabled,
  isTransferGameEnabled,
  MANUAL_PLAYTIME_WARNING_CONTROLS,
  resolveDangerZonePreferences,
  resolveManualPlaytimeWarningPreferences,
  resolveSocialPreferences,
  SOCIAL_COMMUNITY_CONTROLS,
  SOCIAL_LEADERBOARD_METRIC_CONTROLS,
  SOCIAL_LEADERBOARD_SURFACE_CONTROLS,
  SOCIAL_NAVIGATION_CONTROLS,
  type ResolvedSocialPreferences,
} from "@shared";
import type { NetworkInterface, UserPreferences } from "@types";
import { SettingsDirectTorrents } from "./settings-direct-torrents";
import { SettingsHttpDownloads } from "./settings-http-downloads";
import { SettingsGlobalTrackers } from "./settings-global-trackers";
import { SettingsCompanionApps } from "./settings-companion-apps";
import { SettingsBulkRemoveLibrary } from "./settings-bulk-remove-library";
import { SettingsLudusaviAdvanced } from "./settings-ludusavi-advanced";
import { SettingsSourceWebsites } from "./settings-source-websites";
import { SettingsReset } from "./settings-reset";
import { SettingsCollapsibleMenu } from "./settings-collapsible-menu";
import { SettingsControllerWake } from "./settings-controller-wake";
import {
  getDownloadOptionInteraction,
  type DownloadOptionInteraction,
} from "../../../../shared/download-option-interaction";

import "./settings-general.scss";

const buildForm = (preferences: UserPreferences | null) => {
  preferences = withResetDefaults(preferences);
  return {
    seedAfterDownloadComplete: preferences?.seedAfterDownloadComplete ?? false,
    torrentNetworkInterface: preferences?.torrentNetworkInterface ?? "",
    enableClassics: isClassicsEnabled(preferences),
    enableTransferGame: isTransferGameEnabled(preferences),
    showHydraAchievementPoints: isHydraAchievementPointsEnabled(preferences),
    enableSourceBrowser: preferences?.enableSourceBrowser !== false,
    alwaysMuteTrailersByDefault:
      preferences?.alwaysMuteTrailersByDefault === true,
    downloadOptionInteraction: getDownloadOptionInteraction(preferences),
    ...resolveDangerZonePreferences(preferences),
    ...resolveManualPlaytimeWarningPreferences(preferences),
    ...resolveSocialPreferences(preferences),
  };
};

export function SettingsContextAdvanced() {
  const { t } = useTranslation("settings");
  const [searchParams] = useSearchParams();
  const requestedGameKey = searchParams.get("game") ?? "";
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
  const [openSections, setOpenSections] = useState<Record<string, boolean>>(
    () => ({
      saveBackups: Boolean(requestedGameKey),
      reset: false,
    })
  );

  const toggleSection = (key: string) =>
    setOpenSections((prev) => ({ ...prev, [key]: !prev[key] }));

  useEffect(() => {
    if (requestedGameKey) {
      setOpenSections((prev) =>
        prev.saveBackups ? prev : { ...prev, saveBackups: true }
      );
    }
  }, [requestedGameKey]);

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
    const patch: Partial<UserPreferences> = { ...values };
    if (Object.hasOwn(values, "showCommunityScreenshots")) {
      const nextValue = (values as { showCommunityScreenshots?: boolean })
        .showCommunityScreenshots;
      delete (patch as { showCommunityScreenshots?: boolean })
        .showCommunityScreenshots;
      patch.hideCommunityScreenshots = !nextValue;
    }
    setForm((prev) => ({ ...prev, ...values }));
    updateUserPreferences(patch);
  };

  const applySocialPatch = (patch: Partial<UserPreferences>) => {
    const resolved = resolveSocialPreferences({
      ...userPreferences,
      ...patch,
    });
    setForm((prev) => ({
      ...prev,
      ...resolved,
    }));
    updateUserPreferences(patch);
  };

  const toggleSocialPreference = (key: keyof ResolvedSocialPreferences) => {
    applySocialPatch(
      buildSocialPreferenceUpdatePatch(userPreferences, {
        [key]: !form[key],
      })
    );
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

      <SettingsCollapsibleMenu
        classPrefix="settings-context-advanced__menu"
        title={t("advanced_download_protection_title")}
        description={t("advanced_download_protection_description")}
        open={Boolean(openSections.protection)}
        onToggle={() => toggleSection("protection")}
      >
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

          <hr className="settings-context-advanced__divider" />
          <h4>{t("global_trackers")}</h4>
          <SettingsGlobalTrackers />
        </SettingsDirectTorrents>
      </SettingsCollapsibleMenu>

      <SettingsCollapsibleMenu
        classPrefix="settings-context-advanced__menu"
        title={t("advanced_http_downloads_title")}
        description={t("advanced_http_downloads_description")}
        open={Boolean(openSections.httpDownloads)}
        onToggle={() => toggleSection("httpDownloads")}
      >
        <SettingsHttpDownloads />
      </SettingsCollapsibleMenu>

      <SettingsCollapsibleMenu
        classPrefix="settings-context-advanced__menu"
        title={t("companion_apps_title")}
        description={t("companion_apps_description")}
        open={Boolean(openSections.companionApps)}
        onToggle={() => toggleSection("companionApps")}
      >
        <SettingsCompanionApps />
      </SettingsCollapsibleMenu>

      <SettingsCollapsibleMenu
        classPrefix="settings-context-advanced__menu"
        title={t("advanced_controller_wake_title")}
        description={t("advanced_controller_wake_description")}
        open={Boolean(openSections.controllerWake)}
        onToggle={() => toggleSection("controllerWake")}
      >
        <SettingsControllerWake />
      </SettingsCollapsibleMenu>

      <SettingsCollapsibleMenu
        classPrefix="settings-context-advanced__menu"
        title={t("advanced_source_websites_title")}
        description={t("advanced_source_websites_description")}
        open={Boolean(openSections.sourceWebsites)}
        onToggle={() => toggleSection("sourceWebsites")}
      >
        <CheckboxField
          label="Enable source website browsing"
          checked={form.enableSourceBrowser}
          onChange={() =>
            handleChange({ enableSourceBrowser: !form.enableSourceBrowser })
          }
        />
        <p className="settings-context-advanced__hint">
          Shows one Search on action per configured website above the download
          options. Searches start with the selected game’s title; website
          selections are labeled separately from Hydra feed entries. Turning it
          off closes source windows and discards unsubmitted links; existing
          downloads continue.
        </p>
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
              label: "Hydra action menu — add a step before download options",
            },
            {
              key: "website-only",
              value: "website-only",
              label: "Website only — release cards are not clickable",
            },
          ]}
        />
        <p className="settings-context-advanced__hint">
          Website searches appear once per configured site, separately from the
          Hydra feed list. Native opens Hydra’s download options directly from a
          release. The Hydra action menu adds a menu step first. Website only
          makes feed release cards non-clickable while leaving the website
          search actions available when browsing is enabled.
        </p>
        {form.downloadOptionInteraction === "website-only" &&
          !form.enableSourceBrowser && (
            <p role="alert" className="local-edition__safety-warning">
              {t("website_only_browsing_disabled_warning")}
            </p>
          )}
        <hr className="settings-context-advanced__divider" />
        <SettingsSourceWebsites />
      </SettingsCollapsibleMenu>

      <SettingsCollapsibleMenu
        classPrefix="settings-context-advanced__menu"
        title={t("features")}
        description={t("advanced_features_description")}
        open={Boolean(openSections.features)}
        onToggle={() => toggleSection("features")}
      >
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
          label={t("show_hydra_achievement_points")}
          checked={form.showHydraAchievementPoints}
          onChange={() =>
            handleChange({
              showHydraAchievementPoints: !form.showHydraAchievementPoints,
            })
          }
        />
        <p className="settings-context-advanced__hint">
          {t("show_hydra_achievement_points_hint")}
        </p>
      </SettingsCollapsibleMenu>

      <SettingsCollapsibleMenu
        classPrefix="settings-context-advanced__menu"
        title="Title Danger Zone & destructive actions"
        description="Control access to the Danger Zone tab in title settings and individual destructive actions across title settings and game context menus."
        open={Boolean(openSections.dangerZone)}
        onToggle={() => toggleSection("dangerZone")}
      >
        <div className="settings-context-advanced__actions">
          <Button
            type="button"
            theme="outline"
            disabled={areAllDangerZonePreferencesDisabled(form)}
            onClick={() =>
              handleChange(buildDisableAllDangerZonePreferencesPatch())
            }
          >
            Disable all
          </Button>
          <Button
            type="button"
            theme="outline"
            disabled={areAllDangerZonePreferencesEnabled(form)}
            onClick={() =>
              handleChange(buildEnableAllDangerZonePreferencesPatch())
            }
          >
            Enable all
          </Button>
        </div>

        <hr className="settings-context-advanced__divider" />

        <div className="settings-context-advanced__social-group">
          <CheckboxField
            label={DANGER_ZONE_MASTER_CONTROL.label}
            checked={form.enableDangerZone}
            onChange={() =>
              handleChange({ enableDangerZone: !form.enableDangerZone })
            }
          />
          {DANGER_ZONE_MASTER_CONTROL.description && (
            <p className="settings-context-advanced__hint">
              {DANGER_ZONE_MASTER_CONTROL.description}
            </p>
          )}
        </div>

        <hr className="settings-context-advanced__divider" />

        <div className="settings-context-advanced__social-group">
          <h4>Individual actions</h4>
          <p className="settings-context-advanced__hint">
            Toggle each Danger Zone feature independently. Disabling Remove game
            files or Remove from library also hides them from game context
            menus. If every action below is turned off, the Danger Zone tab is
            hidden automatically.
          </p>
          {DANGER_ZONE_ACTION_CONTROLS.map((control) => (
            <CheckboxField
              key={control.key}
              label={control.label}
              checked={form[control.key]}
              onChange={() =>
                handleChange({ [control.key]: !form[control.key] })
              }
            />
          ))}
        </div>

        <hr className="settings-context-advanced__divider" />

        <div className="settings-context-advanced__social-group">
          <h4>Manual playtime warnings</h4>
          <p className="settings-context-advanced__hint">
            Control whether the warning icon and warning text or tooltips appear
            when updating playtime manually and on games with manually updated
            playtime.
          </p>
          {MANUAL_PLAYTIME_WARNING_CONTROLS.map((control) => (
            <CheckboxField
              key={control.key}
              label={control.label}
              checked={form[control.key]}
              onChange={() =>
                handleChange({ [control.key]: !form[control.key] })
              }
            />
          ))}
        </div>
      </SettingsCollapsibleMenu>

      <SettingsCollapsibleMenu
        classPrefix="settings-context-advanced__menu"
        title={t("advanced_media_title")}
        description={t("advanced_media_description")}
        open={Boolean(openSections.media)}
        onToggle={() => toggleSection("media")}
      >
        <CheckboxField
          label={t("always_mute_trailers_by_default")}
          checked={form.alwaysMuteTrailersByDefault}
          onChange={() =>
            handleChange({
              alwaysMuteTrailersByDefault: !form.alwaysMuteTrailersByDefault,
            })
          }
        />
        <p className="settings-context-advanced__hint">
          {t("always_mute_trailers_by_default_hint")}
        </p>
      </SettingsCollapsibleMenu>

      <SettingsCollapsibleMenu
        classPrefix="settings-context-advanced__menu"
        title="Social & community visibility"
        description="Granularly toggle leaderboard surfaces, leaderboard categories (like Playtime vs. Achievements/Trophies), community stats, friends/chat, and sidebar elements."
        open={Boolean(openSections.social)}
        onToggle={() => toggleSection("social")}
      >
        <div className="settings-context-advanced__actions">
          <Button
            type="button"
            theme="outline"
            disabled={areAllSocialPreferencesDisabled(form)}
            onClick={() =>
              applySocialPatch(buildDisableAllSocialPreferencesPatch())
            }
          >
            Disable all social features
          </Button>
          <Button
            type="button"
            theme="outline"
            onClick={() => {
              setOpenSections((prev) => ({ ...prev, reset: true }));
              requestAnimationFrame(() =>
                document
                  .getElementById("settings-reset-section")
                  ?.scrollIntoView({ block: "start", behavior: "smooth" })
              );
            }}
          >
            Open reset and recovery
          </Button>
        </div>

        <hr className="settings-context-advanced__divider" />

        <div className="settings-context-advanced__social-group">
          <h4>Leaderboards &amp; rankings</h4>
          {SOCIAL_LEADERBOARD_SURFACE_CONTROLS.map((control) => (
            <CheckboxField
              key={control.key}
              label={control.label}
              checked={form[control.key]}
              onChange={() => toggleSocialPreference(control.key)}
            />
          ))}

          <h4>Visible leaderboard categories</h4>
          <p className="settings-context-advanced__hint">
            Choose which categories appear on the global Leaderboards page, game
            ranking cards, badges, and rank alerts.
          </p>
          <div className="settings-context-advanced__social-categories">
            {SOCIAL_LEADERBOARD_METRIC_CONTROLS.map((control) => (
              <CheckboxField
                key={control.key}
                label={control.label}
                checked={form[control.key]}
                onChange={() => toggleSocialPreference(control.key)}
              />
            ))}
          </div>
        </div>

        <hr className="settings-context-advanced__divider" />

        <div className="settings-context-advanced__social-group">
          <h4>Community &amp; game pages</h4>
          {SOCIAL_COMMUNITY_CONTROLS.map((control) => (
            <CheckboxField
              key={control.key}
              label={control.label}
              checked={form[control.key]}
              onChange={() => toggleSocialPreference(control.key)}
            />
          ))}
        </div>

        <hr className="settings-context-advanced__divider" />

        <div className="settings-context-advanced__social-group">
          <h4>Friends, chat &amp; sidebar</h4>
          {SOCIAL_NAVIGATION_CONTROLS.map((control) => (
            <CheckboxField
              key={control.key}
              label={control.label}
              checked={form[control.key]}
              onChange={() => toggleSocialPreference(control.key)}
            />
          ))}
        </div>
      </SettingsCollapsibleMenu>

      <SettingsCollapsibleMenu
        classPrefix="settings-context-advanced__menu"
        title={t("library_maintenance_title")}
        description={t("library_maintenance_description")}
        open={Boolean(openSections.library)}
        onToggle={() => toggleSection("library")}
      >
        <SettingsBulkRemoveLibrary />
      </SettingsCollapsibleMenu>

      <SettingsCollapsibleMenu
        classPrefix="settings-context-advanced__menu"
        extraClassName="settings-context-advanced__menu--save-backups"
        title={t("save_backups_advanced_title", { ns: "ludusavi" })}
        description={t("save_backups_advanced_description", { ns: "ludusavi" })}
        open={Boolean(openSections.saveBackups)}
        onToggle={() => toggleSection("saveBackups")}
      >
        <SettingsLudusaviAdvanced />
      </SettingsCollapsibleMenu>

      <SettingsCollapsibleMenu
        id="settings-reset-section"
        classPrefix="settings-context-advanced__menu"
        title="Reset and recovery"
        description="Review category resets and recover previous settings."
        open={Boolean(openSections.reset)}
        onToggle={() => toggleSection("reset")}
      >
        {openSections.reset && <SettingsReset />}
      </SettingsCollapsibleMenu>
    </div>
  );
}
