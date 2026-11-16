import { useEffect, useState, type ReactNode } from "react";
import type { GameRepack, GameShop } from "@types";
import type { SourceWebsiteProfile } from "../../../types/source-browser.types";
import {
  orderSourceWebsiteProfiles,
  websiteSearchRepack,
} from "../../../shared/source-browser-policy";

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
  const [orderedIds, setOrderedIds] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    setProfiles(null);
    setError("");
    if (!enabled) return;
    let active = true;
    setLoading(true);
    void Promise.all([
      window.electron.getSourceWebsiteProfiles(),
      window.electron.getUserPreferences(),
    ])
      .then(([saved, preferences]) => {
        if (active) {
          setProfiles(saved);
          setOrderedIds(
            orderSourceWebsiteProfiles(
              saved,
              preferences?.sourceWebsiteSearchOrder
            )
          );
        }
      })
      .catch((cause) => {
        if (active) setError(String(cause));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
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
      {loading && <span role="status">Loading websites…</span>}
      {profiles && Object.entries(profiles).length > 0 && (
        <div role="group" aria-label="Search on a website">
          {orderedIds.map((id) => {
            const profile = profiles[id];
            if (!profile) return null;
            const name = profile.name ?? new URL(profile.website).hostname;
            return renderButton({
              id: `search-website-${id}`,
              label: busy ? `Opening ${name}…` : `Search on ${name}`,
              disabled: busy,
              onClick: () =>
                void run(async () => {
                  const selection = await window.electron.openSourceBrowser({
                    websiteProfileId: id,
                    shop,
                    objectId,
                    gameTitle,
                    repack: websiteSearchRepack(id, profile, gameTitle),
                  });
                  if (selection) onReview(selection);
                }),
            });
          })}
        </div>
      )}
      {profiles && Object.keys(profiles).length > 0 && (
        <span className="source-website-search__note">
          Website searches are separate from Hydra feed results.
        </span>
      )}
      {profiles && !Object.keys(profiles).length && (
        <span>No websites configured.</span>
      )}
      {(!profiles || !Object.keys(profiles).length) && error && onSettings &&
        renderButton({
          id: "configure-websites",
          label: "Configure websites",
          disabled: busy,
          onClick: onSettings,
        })}
      {profiles && !Object.keys(profiles).length && onSettings &&
        renderButton({
          id: "configure-websites",
          label: "Configure websites",
          disabled: busy,
          onClick: onSettings,
        })}
      {error && <p role="alert">{error}</p>}
    </div>
  );
}
