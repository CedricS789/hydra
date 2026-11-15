import { useSettingsOperationGuard } from "@renderer/context/settings/settings-draft.context";
import { useSettingsFormGuard } from "@renderer/context/settings/settings-draft.context";
import { useContext, useEffect, useState } from "react";
import { Trans, useTranslation } from "react-i18next";

import { Button, CheckboxField, Link, TextField } from "@renderer/components";
import "./settings-torbox.scss";

import { useAppSelector, useToast } from "@renderer/hooks";

import { settingsContext } from "@renderer/context";
import { LinkExternalIcon } from "@primer/octicons-react";

const torBoxReferralCode = import.meta.env.RENDERER_VITE_TORBOX_REFERRAL_CODE;

const TORBOX_URL = torBoxReferralCode
  ? `https://torbox.app/subscription?referral=${torBoxReferralCode}`
  : "https://torbox.app";
const TORBOX_API_TOKEN_URL = "https://torbox.app/settings";

export function SettingsTorBox() {
  const userPreferences = useAppSelector(
    (state) => state.userPreferences.value
  );

  const { updateUserPreferences } = useContext(settingsContext);

  const [isLoading, setIsLoading] = useState(false);
  useSettingsOperationGuard("settings-torbox", isLoading);
  const [form, setForm] = useState(() => ({
    useTorBox: Boolean(userPreferences?.torBoxApiToken),
    torBoxApiToken: userPreferences?.torBoxApiToken ?? null,
  }));

  const { showSuccessToast, showErrorToast } = useToast();

  const { t } = useTranslation("settings");

  const savedToken = userPreferences?.torBoxApiToken ?? null;
  useEffect(() => {
    setForm({ useTorBox: Boolean(savedToken), torBoxApiToken: savedToken });
  }, [savedToken]);

  const dirty =
    form.useTorBox !== Boolean(userPreferences?.torBoxApiToken) ||
    (form.useTorBox &&
      form.torBoxApiToken !== (userPreferences?.torBoxApiToken ?? null));
  useSettingsFormGuard("provider-torbox", dirty, "TorBox connection");

  const handleFormSubmit: React.FormEventHandler<HTMLFormElement> = async (
    event
  ) => {
    setIsLoading(true);
    event.preventDefault();

    try {
      if (form.useTorBox) {
        await window.electron.authenticateTorBox(form.torBoxApiToken!);
      }

      await updateUserPreferences({
        torBoxApiToken: form.useTorBox ? form.torBoxApiToken : null,
      });
      showSuccessToast(t("changes_saved"));
    } catch (err) {
      showErrorToast(
        err instanceof Error ? err.message : t("debrid_invalid_token")
      );
    } finally {
      setIsLoading(false);
    }
  };

  const isButtonDisabled =
    (form.useTorBox && !form.torBoxApiToken) || isLoading;

  const toggleTorBox = () => {
    const updatedValue = !form.useTorBox;

    setForm((prev) => ({
      ...prev,
      useTorBox: updatedValue,
    }));
  };

  return (
    <form className="settings-torbox__form" onSubmit={handleFormSubmit}>
      <div className="settings-torbox__description-container">
        <p className="settings-torbox__description">
          {t("torbox_description")}
        </p>
        <Link to={TORBOX_URL} className="settings-torbox__create-account">
          <LinkExternalIcon />
          {t("create_torbox_account")}
        </Link>
      </div>

      <CheckboxField
        label={t("enable_torbox")}
        checked={form.useTorBox}
        disabled={isLoading}
        onChange={toggleTorBox}
      />

      {form.useTorBox && (
        <TextField
          label={t("api_token")}
          value={form.torBoxApiToken ?? ""}
          type="password"
          onChange={(event) =>
            setForm({ ...form, torBoxApiToken: event.target.value })
          }
          placeholder={t("api_token")}
          rightContent={
            <Button type="submit" disabled={isButtonDisabled || !dirty}>
              {t("save_changes")}
            </Button>
          }
          hint={
            <Trans i18nKey="debrid_api_token_hint" ns="settings">
              <Link to={TORBOX_API_TOKEN_URL} />
            </Trans>
          }
        />
      )}
      {!form.useTorBox && (
        <Button type="submit" disabled={isLoading || !dirty}>
          {t("save_changes")}
        </Button>
      )}
    </form>
  );
}
