import { useEffect, useState, type MouseEvent } from "react";
import { ContextMenu } from "../../common";
import { DownloadSourceOption } from "../../common/download-source-option";
import type { GameRepack } from "@types";
import type { DownloadOptionInteraction } from "../../../../../shared/download-option-interaction";
import type { FocusOverrides } from "../../../services";

export function BigPictureReleaseDownloadOption({
  option,
  mode,
  onDownload,
  stealFocusOnAppear,
  focusNavigationOverrides,
}: {
  option: GameRepack;
  mode: DownloadOptionInteraction;
  onDownload: () => void;
  stealFocusOnAppear: boolean;
  focusNavigationOverrides?: FocusOverrides;
}) {
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  useEffect(() => setMenu(null), [mode]);
  const focusId = `source-release-${option.id}`;
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
      <ContextMenu
        visible={mode === "menu" && Boolean(menu)}
        position={menu ?? { x: 0, y: 0 }}
        ariaLabel="Release actions"
        restoreFocusId={focusId}
        onClose={() => setMenu(null)}
        items={[
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
