import { useEffect, useState, type ReactNode } from "react";
import * as Menu from "@radix-ui/react-dropdown-menu";
import { Button } from "@renderer/components/button/button";
import type { DownloadOptionInteraction } from "../../../../../shared/download-option-interaction";
import "@renderer/components/dropdown-menu/dropdown-menu.scss";

export function ReleaseDownloadOption({
  children,
  mode,
  onDownload,
}: {
  children: ReactNode;
  mode: DownloadOptionInteraction;
  onDownload: () => void;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  useEffect(() => setMenuOpen(false), [mode]);
  return (
    <div className="repacks-modal__source-entry">
      {mode === "menu" ? (
        <Menu.Root open={menuOpen} onOpenChange={setMenuOpen}>
          <Menu.Trigger asChild>
            <Button
              theme="dark"
              className="repacks-modal__repack-button"
              aria-label="Open Hydra download options menu"
              onContextMenu={(event) => {
                event.preventDefault();
                setMenuOpen(true);
              }}
            >
              {children}
              <span className="repacks-modal__action-hint">
                Open download options…
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
                Hydra download
              </Menu.Label>
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
    </div>
  );
}
