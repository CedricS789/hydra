import { useContext, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Button, CheckboxField, TextField } from "@renderer/components";
import { settingsContext } from "@renderer/context";
import { useAppSelector } from "@renderer/hooks";
import { allowsDirectTorrent, DIRECT_TORRENT_CONFIRMATION } from "@shared";
import "./settings-direct-torrents.scss";

export function SettingsDirectTorrents({ children }: { children: ReactNode }) {
  const { t } = useTranslation("settings");
  const { updateUserPreferences } = useContext(settingsContext);
  const preferences = useAppSelector((state) => state.userPreferences.value);
  const enabled = allowsDirectTorrent(preferences);
  const [acknowledged, setAcknowledged] = useState(false);
  const [confirmation, setConfirmation] = useState("");
  const [working, setWorking] = useState(false);
  const [error, setError] = useState("");
  const changeAccess = async (allow: boolean) => {
    setWorking(true);
    setError("");
    try {
      await updateUserPreferences(
        { allowDirectTorrent: allow, seedAfterDownloadComplete: false },
        allow ? confirmation : undefined
      );
      setAcknowledged(false);
      setConfirmation("");
    } catch (error) {
      setError(error instanceof Error ? error.message : String(error));
    } finally {
      setWorking(false);
    }
  };

  return (
    <section className="settings-direct-torrents">
      <h3>{t("direct_torrents_title")}</h3>
      <p role="status">
        {t(enabled ? "direct_torrents_on" : "direct_torrents_off")}
      </p>
      <p>{t("direct_torrents_description")}</p>
      {error && (
        <p role="alert" className="settings-direct-torrents__error">
          {error}
        </p>
      )}
      {enabled && (
        <Button
          theme="outline"
          disabled={working}
          onClick={() => void changeAccess(false)}
        >
          {t("direct_torrents_disable")}
        </Button>
      )}
      <details
        onToggle={(event) => {
          if (!event.currentTarget.open) {
            setAcknowledged(false);
            setConfirmation("");
          }
        }}
      >
        <summary>{t("direct_torrents_advanced")}</summary>
        <div className="settings-direct-torrents__advanced">
          {!enabled ? (
            <>
              <p>{t("direct_torrents_warning")}</p>
              <CheckboxField
                label={t("direct_torrents_acknowledge")}
                checked={acknowledged}
                disabled={working}
                onChange={(event) => setAcknowledged(event.target.checked)}
              />
              <TextField
                label={t("direct_torrents_confirmation", {
                  phrase: DIRECT_TORRENT_CONFIRMATION,
                })}
                value={confirmation}
                disabled={working}
                autoComplete="off"
                spellCheck={false}
                onChange={(event) => setConfirmation(event.target.value)}
              />
              <Button
                disabled={
                  working ||
                  !acknowledged ||
                  confirmation !== DIRECT_TORRENT_CONFIRMATION
                }
                onClick={() => void changeAccess(true)}
              >
                {t("direct_torrents_enable")}
              </Button>
            </>
          ) : (
            children
          )}
        </div>
      </details>
    </section>
  );
}
