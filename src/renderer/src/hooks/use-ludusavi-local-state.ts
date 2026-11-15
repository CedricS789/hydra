import { useCallback, useEffect, useState } from "react";
import type { LudusaviLocalState } from "@types";

/**
 * Loads Ludusavi local save backup state and stays subscribed to backend updates.
 */
export function useLudusaviLocalState(pollMs?: number) {
  const [state, setState] = useState<LudusaviLocalState>();
  const [error, setError] = useState("");

  const refresh = useCallback(async () => {
    const value = await window.electron.getLudusaviLocalState();
    setState(value);
    setError("");
    return value;
  }, []);

  useEffect(() => {
    let mounted = true;
    const sync = () => {
      window.electron
        .getLudusaviLocalState()
        .then((value) => {
          if (!mounted) return;
          setState(value);
          setError("");
        })
        .catch((err) => {
          if (mounted) setError(String(err));
        });
    };

    sync();

    const unsubscribe =
      typeof window.electron.onLudusaviStateChanged === "function"
        ? window.electron.onLudusaviStateChanged(sync)
        : undefined;

    const timer = pollMs && pollMs > 0 ? setInterval(sync, pollMs) : undefined;

    return () => {
      mounted = false;
      unsubscribe?.();
      if (timer) clearInterval(timer);
    };
  }, [pollMs]);

  return { state, setState, error, setError, refresh };
}
