import { useEffect, useState, type ReactNode } from "react";
import * as Menu from "@radix-ui/react-dropdown-menu";
import { Button } from "@renderer/components/button/button";
import { useSourceBrowser } from "@renderer/components/source-browser-button";
import type { GameRepack } from "@types";
import type { SourceBrowserRequest } from "../../../../../types/source-browser.types";
import type { DownloadOptionInteraction } from "../../../../../shared/download-option-interaction";
import "@renderer/components/dropdown-menu/dropdown-menu.scss";

export function ReleaseDownloadOption({
  children,
  mode,
  browsingEnabled,
  request,
  onDownload,
  onReview,
}: {
  children: ReactNode;
  mode: DownloadOptionInteraction;
  browsingEnabled: boolean;
  request: SourceBrowserRequest;
  onDownload: () => void;
  onReview: (repack: GameRepack) => void;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  useEffect(() => setMenuOpen(false), [mode, browsingEnabled]);
  const browser = useSourceBrowser(request, onReview);
  const browse = () => {
    setMenuOpen(false);
    void browser.open();
  };
  const sourceButton = browsingEnabled ? (
    <Button theme="outline" disabled={browser.busy} onClick={browse}>
      {browser.busy ? "Source browser open…" : "View source"}
    </Button>
  ) : null;
  return (
    <div className="repacks-modal__source-entry">
      {mode === "menu" ? (
        <Menu.Root open={menuOpen} onOpenChange={setMenuOpen}>
          <Menu.Trigger asChild>
            <Button
              theme="dark"
              className="repacks-modal__repack-button"
              aria-label={`Actions for ${request.repack.title}`}
              onContextMenu={(event) => {
                event.preventDefault();
                setMenuOpen(true);
              }}
            >
              {children}
              <span className="repacks-modal__action-hint">
                Choose an action…
              </span>
            </Button>
          </Menu.Trigger>
          <Menu.Portal>
            <Menu.Content
              className="dropdown-menu__content"
              align="end"
              sideOffset={6}
              collisionPadding={16}
            >
              <Menu.Label className="dropdown-menu__title-bar">
                Release actions
              </Menu.Label>
              {browsingEnabled && (
                <Menu.Item
                  className="dropdown-menu__item"
                  disabled={browser.busy}
                  onSelect={browse}
                >
                  View source website
                </Menu.Item>
              )}
              <Menu.Item
                className="dropdown-menu__item"
                onSelect={() => {
                  setMenuOpen(false);
                  onDownload();
                }}
              >
                Download options in Hydra…
              </Menu.Item>
            </Menu.Content>
          </Menu.Portal>
        </Menu.Root>
      ) : mode === "native" ? (
        <Button
          theme="dark"
          onClick={onDownload}
          className="repacks-modal__repack-button"
        >
          {children}
        </Button>
      ) : (
        <div className="repacks-modal__repack-static">{children}</div>
      )}
      {mode !== "menu" && sourceButton}
      {mode === "website-only" && !browsingEnabled && (
        <p className="repacks-modal__action-hint">
          Source browsing is disabled. Enable it or change the download option
          interaction in Settings → Advanced → Features.
        </p>
      )}
      {browser.error && (
        <p role="alert" className="local-edition__error">
          {browser.error}
        </p>
      )}
    </div>
  );
}
