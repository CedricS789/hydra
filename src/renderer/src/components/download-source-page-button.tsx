import { SourceBrowserButton } from "./source-browser-button";
import { useAppSelector } from "@renderer/hooks";
import type { LibraryGame } from "@types";
import type { ReactNode } from "react";

export function DownloadSourcePageButton({
  game,
  enabled: overrideEnabled,
  renderTrigger,
}: {
  game: LibraryGame;
  enabled?: boolean;
  renderTrigger?: (props: {
    disabled: boolean;
    onClick: () => void;
    children: string;
  }) => ReactNode;
}) {
  const enabled = useAppSelector(
    (state) => state.userPreferences.value?.enableSourceBrowser !== false
  );
  const download = game.download;
  if (!download?.downloadSourceName || !download.sourcePageUrl) return null;
  return (
    <SourceBrowserButton
      enabled={overrideEnabled ?? enabled}
      renderTrigger={renderTrigger}
      request={{
        shop: game.shop,
        objectId: game.objectId,
        gameTitle: game.title,
        readOnly: true,
        repack: {
          id: game.id,
          title: download.repackTitle ?? game.title,
          fileSize: download.repackFileSize ?? null,
          downloadSourceId:
            download.downloadSourceId ?? download.downloadSourceName,
          downloadSourceName: download.downloadSourceName,
          sourcePageUrl: download.sourcePageUrl,
          uris: [],
          unavailableUris: [],
          uploadDate: download.uploadDate ?? null,
          createdAt: "",
        },
      }}
      onReview={() => {}}
    />
  );
}
