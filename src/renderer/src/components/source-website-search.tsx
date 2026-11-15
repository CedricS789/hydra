import { useEffect, useState, type ReactNode } from "react";
import type { GameRepack, GameShop } from "@types";
import type { SourceWebsiteProfile } from "../../../types/source-browser.types";
import { websiteSearchRepack } from "../../../shared/source-browser-policy";

/** Shared flow; each surface supplies its own keyboard/controller buttons. */
export function SourceWebsiteSearch({
  enabled,
  shop,
  objectId,
  gameTitle,
  onReview,
  onSettings,
  renderButton,
}: {
  enabled: boolean;
  shop: GameShop;
  objectId: string;
  gameTitle: string;
  onReview: (selection: GameRepack) => void;
  onSettings?: () => void;
  renderButton: (props: {
    id: string;
    label: string;
    disabled: boolean;
    onClick: () => void;
  }) => ReactNode;
}) {
  const [profiles, setProfiles] = useState<Record<
    string,
    SourceWebsiteProfile
  > | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    setProfiles(null);
    setError("");
  }, [enabled, shop, objectId, gameTitle]);
  if (!enabled) return null;
  const run = async (action: () => Promise<void>) => {
    setBusy(true);
    setError("");
    try {
      await action();
    } catch (error) {
      setError(String(error));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="source-website-search">
      {renderButton({
        id: "search-websites",
        label: busy ? "Please wait…" : "Search source websites",
        disabled: busy,
        onClick: () =>
          void run(async () => {
            setProfiles(await window.electron.getSourceWebsiteProfiles());
          }),
      })}
      {profiles && (
        <div role="group" aria-label="Choose a source website">
          {Object.entries(profiles).map(([id, profile]) => (
            <div key={id}>
              {renderButton({
                id: `search-website-${id}`,
                label: profile.name ?? new URL(profile.website).hostname,
                disabled: busy,
                onClick: () =>
                  void run(async () => {
                    const selection = await window.electron.openSourceBrowser({
                      shop,
                      objectId,
                      gameTitle,
                      repack: websiteSearchRepack(id, profile, gameTitle),
                    });
                    if (selection) {
                      setProfiles(null);
                      onReview(selection);
                    }
                  }),
              })}
            </div>
          ))}
          {!Object.keys(profiles).length && (
            <p>No source websites configured.</p>
          )}
          {onSettings ? (
            renderButton({
              id: "configure-websites",
              label: "Configure websites in Advanced settings",
              disabled: busy,
              onClick: onSettings,
            })
          ) : (
            <p>
              Configure websites in desktop Settings → Advanced → Features →
              Source website profiles and cookies.
            </p>
          )}
          {renderButton({
            id: "close-websites",
            label: "Cancel",
            disabled: busy,
            onClick: () => setProfiles(null),
          })}
        </div>
      )}
      {error && <p role="alert">{error}</p>}
    </div>
  );
}
