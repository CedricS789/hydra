import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type { GameRepack } from "@types";
import type { SourceBrowserRequest } from "../../../types/source-browser.types";
import { sourceBrowserRequestKey } from "../../../shared/source-browser-policy";

/** Tracks in-flight source browser launches and clears opening state once the window opens. */
export function useSourceBrowserOpener(onReview: (repack: GameRepack) => void) {
  const [openingKeys, setOpeningKeys] = useState<Set<string>>(() => new Set());
  const activeTokensRef = useRef(new Map<string, symbol>());
  const [error, setError] = useState("");
  const onReviewRef = useRef(onReview);
  onReviewRef.current = onReview;

  const removeOpeningKey = useCallback((key: string) => {
    setOpeningKeys((prev) => {
      if (!prev.has(key)) return prev;
      const next = new Set(prev);
      next.delete(key);
      return next;
    });
  }, []);

  useEffect(() => {
    return window.electron.onSourceBrowserOpened?.((openedKey) => {
      activeTokensRef.current.delete(openedKey);
      removeOpeningKey(openedKey);
    });
  }, [removeOpeningKey]);

  const isOpening = useCallback(
    (request: SourceBrowserRequest) =>
      openingKeys.has(sourceBrowserRequestKey(request)),
    [openingKeys]
  );

  const open = useCallback(
    async (request: SourceBrowserRequest) => {
      const key = sourceBrowserRequestKey(request);
      if (activeTokensRef.current.has(key)) return;
      const token = Symbol();
      activeTokensRef.current.set(key, token);
      setOpeningKeys((prev) => {
        if (prev.has(key)) return prev;
        const next = new Set(prev);
        next.add(key);
        return next;
      });
      setError("");
      try {
        const selection = await window.electron.openSourceBrowser(request);
        if (selection) onReviewRef.current(selection);
      } catch (cause) {
        setError(String(cause));
      } finally {
        if (activeTokensRef.current.get(key) === token) {
          activeTokensRef.current.delete(key);
          removeOpeningKey(key);
        }
      }
    },
    [removeOpeningKey]
  );

  const clearError = useCallback(() => setError(""), []);

  return { isOpening, error, clearError, open };
}

export function useSourceBrowser(
  request: SourceBrowserRequest,
  onReview: (repack: GameRepack) => void
) {
  const { isOpening, error, open } = useSourceBrowserOpener(onReview);
  return {
    busy: isOpening(request),
    error,
    open: () => open(request),
  };
}

export function SourceBrowserButton({
  request,
  enabled,
  onReview,
  renderTrigger,
  label = "View source page",
}: {
  request: SourceBrowserRequest;
  enabled: boolean;
  onReview: (repack: GameRepack) => void;
  label?: string;
  renderTrigger?: (props: {
    disabled: boolean;
    onClick: () => void;
    children: string;
  }) => ReactNode;
}) {
  const { busy, error, open } = useSourceBrowser(request, onReview);
  if (!enabled) return null;
  const trigger = {
    disabled: busy,
    onClick: () => void open(),
    children: busy ? "Opening website…" : label,
  };
  return (
    <div className="source-browser-entry">
      {renderTrigger ? (
        renderTrigger(trigger)
      ) : (
        <button
          type="button"
          {...trigger}
          style={{
            padding: "8px 12px",
            border: "1px solid currentColor",
            borderRadius: 6,
            color: "inherit",
            cursor: "pointer",
            background: "transparent",
          }}
        />
      )}
      {error && (
        <p role="alert" style={{ color: "#ff9990", fontSize: 12 }}>
          {error}
        </p>
      )}
    </div>
  );
}
