import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { IS_DESKTOP } from "../constants";
import type { LibraryGame } from "@types";

export function useLibrary() {
  const [downloadLibrary, setLibrary] = useState<LibraryGame[]>([]);
  const requestId = useRef(0);
  const mounted = useRef(true);
  const library = useMemo(
    () => downloadLibrary.filter((game) => !game.isConcealed),
    [downloadLibrary]
  );

  const updateLibrary = useCallback(async () => {
    if (!IS_DESKTOP) return;
    const request = ++requestId.current;
    const updatedLibrary = await globalThis.window.electron.getLibrary(true);
    if (mounted.current && request === requestId.current)
      setLibrary(updatedLibrary);
  }, []);

  useEffect(() => {
    mounted.current = true;
    const sync = () => {
      void updateLibrary().catch(() => {});
    };
    sync();

    if (!IS_DESKTOP) return;

    const unsubscribeLibraryBatch =
      globalThis.window.electron.onLibraryBatchComplete(() => {
        sync();
      });

    const unsubscribeDownloadsUpdated =
      globalThis.window.electron.onDownloadsUpdated(() => {
        sync();
      });

    const handleLibraryUpdate = sync;
    globalThis.window.addEventListener("library-update", handleLibraryUpdate);

    return () => {
      mounted.current = false;
      requestId.current += 1;
      unsubscribeLibraryBatch();
      unsubscribeDownloadsUpdated();
      globalThis.window.removeEventListener(
        "library-update",
        handleLibraryUpdate
      );
    };
  }, [updateLibrary]);

  return { library, downloadLibrary, updateLibrary };
}
