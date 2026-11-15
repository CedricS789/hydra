import { useSettingsOperationGuard } from "@renderer/context/settings/settings-draft.context";
import { useSettingsFormGuard } from "@renderer/context/settings/settings-draft.context";
import { useContext, useEffect, useState } from "react";
import { Trans, useTranslation } from "react-i18next";

import { Button, CheckboxField, Link, TextField } from "@renderer/components";
import "./settings-real-debrid.scss";

import { useAppSelector, useToast } from "@renderer/hooks";

import { settingsContext } from "@renderer/context";
import { LinkExternalIcon } from "@primer/octicons-react";

const realDebridReferralId = import.meta.env
  .RENDERER_VITE_REAL_DEBRID_REFERRAL_ID;

const REAL_DEBRID_URL = realDebridReferralId
  ? `https://real-debrid.com/?id=${realDebridReferralId}`
  : "https://real-debrid.com";
const REAL_DEBRID_API_TOKEN_URL = "https://real-debrid.com/apitoken";

export function SettingsRealDebrid() {
  const userPreferences = useAppSelector(
    (state) => state.userPreferences.value
  );

  const { updateUserPreferences } = useContext(settingsContext);

  const [isLoading, setIsLoading] = useState(false);
  useSettingsOperationGuard("settings-real-debrid", isLoading);
  const [form, setForm] = useState(() => ({
    useRealDebrid: Boolean(userPreferences?.realDebridApiToken),
    realDebridApiToken: userPreferences?.realDebridApiToken ?? null,
  }));

  const { showSuccessToast, showErrorToast } = useToast();

  const { t } = useTranslation("settings");

  const savedToken = userPreferences?.realDebridApiToken ?? null;
  useEffect(() => {
    setForm({
      useRealDebrid: Boolean(savedToken),
      realDebridApiToken: savedToken,
    });
  }, [savedToken]);

  const dirty =
    form.useRealDebrid !== Boolean(userPreferences?.realDebridApiToken) ||
    (form.useRealDebrid &&
      form.realDebridApiToken !==
        (userPreferences?.realDebridApiToken ?? null));
  useSettingsFormGuard("provider-real-debrid", dirty, "Real-Debrid connection");

  const handleFormSubmit: React.FormEventHandler<HTMLFormElement> = async (
    event
  ) => {
    setIsLoading(true);
    event.preventDefault();

    try {
      if (form.useRealDebrid) {
        const user = await window.electron.authenticateRealDebrid(
          form.realDebridApiToken!
        );

        if (user.type === "free") {
          showErrorToast(
            t("real_debrid_free_account_error", { username: user.username })
          );

          return;
        }
      }

      await updateUserPreferences({
        realDebridApiToken: form.useRealDebrid ? form.realDebridApiToken : null,
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

  const toggleRealDebrid = () => {
    const updatedValue = !form.useRealDebrid;

    setForm((prev) => ({
      ...prev,
      useRealDebrid: updatedValue,
    }));
  };

  const isButtonDisabled =
    (form.useRealDebrid && !form.realDebridApiToken) || isLoading;

  return (
    <form className="settings-real-debrid__form" onSubmit={handleFormSubmit}>
      <div className="settings-real-debrid__description-container">
        <p className="settings-real-debrid__description">
          {t("real_debrid_description")}
        </p>
        <Link
          to={REAL_DEBRID_URL}
          className="settings-real-debrid__create-account"
        >
          <LinkExternalIcon />
          {t("create_real_debrid_account")}
        </Link>
      </div>

      <CheckboxField
        label={t("enable_real_debrid")}
        checked={form.useRealDebrid}
        disabled={isLoading}
        onChange={toggleRealDebrid}
      />

      {form.useRealDebrid && (
        <TextField
          label={t("api_token")}
          value={form.realDebridApiToken ?? ""}
          type="password"
          onChange={(event) =>
            setForm({ ...form, realDebridApiToken: event.target.value })
          }
          rightContent={
            <Button type="submit" disabled={isButtonDisabled || !dirty}>
              {t("save_changes")}
            </Button>
          }
          placeholder={t("api_token")}
          hint={
            <Trans i18nKey="debrid_api_token_hint" ns="settings">
              <Link to={REAL_DEBRID_API_TOKEN_URL} />
            </Trans>
          }
        />
      )}
      {!form.useRealDebrid && (
        <Button type="submit" disabled={isLoading || !dirty}>
          {t("save_changes")}
        </Button>
      )}
    </form>
  );
}
