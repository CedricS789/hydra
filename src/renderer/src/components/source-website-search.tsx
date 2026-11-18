import { useEffect, useId, useState, type ReactNode } from "react";
import type { GameRepack, GameShop } from "@types";
import type { SourceWebsiteProfile } from "../../../types/source-browser.types";
import {
  orderSourceWebsiteProfiles,
  websiteSearchRepack,
} from "../../../shared/source-browser-policy";
import { useSourceBrowserOpener } from "./source-browser-button";

/** Shared flow; each surface supplies its own keyboard/controller buttons. */
export function SourceWebsiteSearch({
  enabled,
  shop,
  objectId,
  gameTitle,
  onReview,
  onSettings,
  renderButton,
  renderGroup,
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
    hostname?: string;
    disabled: boolean;
    onClick: () => void;
  }) => ReactNode;
  renderGroup?: (children: ReactNode, headingId: string) => ReactNode;
}) {
  const headingId = useId();
  const [profiles, setProfiles] = useState<Record<
    string,
    SourceWebsiteProfile
  > | null>(null);
  const [orderedIds, setOrderedIds] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const {
    isOpening,
    error: openError,
    clearError,
    open,
  } = useSourceBrowserOpener(onReview);
  useEffect(() => {
    setProfiles(null);
    setError("");
    clearError();
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
  }, [enabled, shop, objectId, gameTitle, clearError]);
  if (!enabled) return null;
  const visibleError = error || openError;
  const hasProfiles = Boolean(profiles && Object.keys(profiles).length > 0);
  const buttons = hasProfiles
    ? orderedIds.map((id) => {
        const profile = profiles![id];
        if (!profile) return null;
        const hostname = new URL(profile.website).hostname;
        const name = profile.name ?? hostname;
        const request = {
          websiteProfileId: id,
          shop,
          objectId,
          gameTitle,
          repack: websiteSearchRepack(id, profile, gameTitle),
        };
        const opening = isOpening(request);
        return renderButton({
          id: `search-website-${id}`,
          label: opening ? `Opening ${name}…` : name,
          hostname,
          disabled: opening,
          onClick: () => {
            setError("");
            void open(request);
          },
        });
      })
    : null;

  return (
    <section className="source-website-search" aria-labelledby={headingId}>
      <span id={headingId} className="source-website-search__title">
        Search on
      </span>
      {loading && (
        <span className="source-website-search__status" role="status">
          Loading websites…
        </span>
      )}
      {hasProfiles &&
        (renderGroup ? (
          renderGroup(buttons, headingId)
        ) : (
          <div
            className="source-website-search__list"
            role="group"
            aria-labelledby={headingId}
          >
            {buttons}
          </div>
        ))}
      {profiles && !Object.keys(profiles).length && (
        <span className="source-website-search__empty">
          No websites configured.
        </span>
      )}
      {!loading &&
        (!profiles || !Object.keys(profiles).length) &&
        onSettings &&
        renderButton({
          id: "configure-websites",
          label: "Configure websites",
          disabled: false,
          onClick: onSettings,
        })}
      {visibleError && (
        <p className="source-website-search__error" role="alert">
          {visibleError}
        </p>
      )}
    </section>
  );
}
