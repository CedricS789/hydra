import { useState, type ReactNode } from "react";
import type { GameRepack } from "@types";
import type { SourceBrowserRequest } from "../../../types/source-browser.types";

export function useSourceBrowser(
  request: SourceBrowserRequest,
  onReview: (repack: GameRepack) => void
) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const open = async () => {
    setBusy(true);
    setError("");
    try {
      const selection = await window.electron.openSourceBrowser(request);
      if (selection) onReview(selection);
    } catch (error) {
      setError(String(error));
    } finally {
      setBusy(false);
    }
  };
  return { busy, error, open };
}

export function SourceBrowserButton({
  request,
  enabled,
  onReview,
  renderTrigger,
}: {
  request: SourceBrowserRequest;
  enabled: boolean;
  onReview: (repack: GameRepack) => void;
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
    children: busy ? "Source browser open…" : "View source",
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
