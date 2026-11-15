import { useEffect, useState, type MouseEvent } from "react";
import { Button, ContextMenu } from "../../common";
import { DownloadSourceOption } from "../../common/download-source-option";
import { useSourceBrowser } from "@renderer/components/source-browser-button";
import type { GameRepack } from "@types";
import type { SourceBrowserRequest } from "../../../../../types/source-browser.types";
import type { DownloadOptionInteraction } from "../../../../../shared/download-option-interaction";
import type { FocusOverrides } from "../../../services";

export function BigPictureReleaseDownloadOption({
  option,
  request,
  mode,
  browsingEnabled,
  onDownload,
  onReview,
  stealFocusOnAppear,
  focusNavigationOverrides,
}: {
  option: GameRepack;
  request: SourceBrowserRequest;
  mode: DownloadOptionInteraction;
  browsingEnabled: boolean;
  onDownload: () => void;
  onReview: (repack: GameRepack) => void;
  stealFocusOnAppear: boolean;
  focusNavigationOverrides?: FocusOverrides;
}) {
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  useEffect(() => setMenu(null), [mode, browsingEnabled]);
  const browser = useSourceBrowser(request, onReview);
  const focusId = `source-release-${option.id}`;
  const browse = () => {
    setMenu(null);
    void browser.open();
  };
  const showMenu = (event?: MouseEvent<HTMLButtonElement>) => {
    event?.preventDefault();
    const bounds = event?.currentTarget.getBoundingClientRect();
    setMenu({
      x: event?.detail ? event.clientX : (bounds?.left ?? 100),
      y: event?.detail ? event.clientY : (bounds?.bottom ?? 100),
    });
  };
  return (
    <div>
      <DownloadSourceOption
        option={option}
        focusId={focusId}
        interactive={mode !== "website-only"}
        stealFocusOnAppear={stealFocusOnAppear}
        focusNavigationOverrides={focusNavigationOverrides}
        onSelect={(_option, event) =>
          mode === "native" ? onDownload() : showMenu(event)
        }
        onContextMenu={mode === "menu" ? showMenu : undefined}
      />
      {mode !== "menu" && browsingEnabled && (
        <Button
          variant="secondary"
          size="small"
          disabled={browser.busy}
          onClick={browse}
          focusId={`source-website-${option.id}`}
        >
          {browser.busy ? "Source browser open…" : "View source"}
        </Button>
      )}
      {mode === "website-only" && !browsingEnabled && (
        <p>
          Source browsing is disabled. Enable it or change the download option
          interaction in Advanced settings.
        </p>
      )}
      {browser.error && <p role="alert">{browser.error}</p>}
      <ContextMenu
        visible={mode === "menu" && Boolean(menu)}
        position={menu ?? { x: 0, y: 0 }}
        ariaLabel="Release actions"
        restoreFocusId={focusId}
        onClose={() => setMenu(null)}
        items={[
          ...(browsingEnabled
            ? [
                {
                  id: "view-source",
                  label: "View source website",
                  disabled: browser.busy,
                  onSelect: browse,
                },
              ]
            : []),
          {
            id: "download-options",
            label: "Download options in Hydra…",
            onSelect: () => {
              setMenu(null);
              onDownload();
            },
          },
        ]}
      />
    </div>
  );
}
