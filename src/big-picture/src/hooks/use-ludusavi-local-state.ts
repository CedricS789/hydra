import { useCallback, useEffect, useRef, useState } from "react";
import type { LudusaviLocalState } from "@types";

/**
 * Loads Ludusavi local save backup state and stays subscribed to backend updates.
 */
export function useLudusaviLocalState(pollMs?: number) {
  const [state, setState] = useState<LudusaviLocalState>();
  const [error, setError] = useState("");
  const requestId = useRef(0);
  const mounted = useRef(true);

  const refresh = useCallback(async () => {
    const request = ++requestId.current;
    try {
      const value = await globalThis.window.electron.getLudusaviLocalState();
      if (mounted.current && request === requestId.current) {
        setState(value);
        setError("");
      }
      return value;
    } catch (error) {
      if (mounted.current && request === requestId.current)
        setError(String(error));
      throw error;
    }
  }, []);

  useEffect(() => {
    mounted.current = true;
    const sync = () => {
      void refresh().catch(() => {});
    };

    sync();

    const unsubscribe =
      typeof globalThis.window.electron.onLudusaviStateChanged === "function"
        ? globalThis.window.electron.onLudusaviStateChanged(sync)
        : undefined;

    const timer =
      pollMs && pollMs > 0
        ? globalThis.window.setInterval(sync, pollMs)
        : undefined;

    return () => {
      mounted.current = false;
      requestId.current += 1;
      unsubscribe?.();
      if (timer) globalThis.window.clearInterval(timer);
    };
  }, [pollMs, refresh]);

  return { state, setState, error, setError, refresh };
}
