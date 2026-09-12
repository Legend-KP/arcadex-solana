"use client";

import { useEffect, useRef, useState } from "react";

export type LeaderboardSubmitToastPhase = "submitting" | "success" | "error";

export interface LeaderboardSubmitToastState {
  phase: LeaderboardSubmitToastPhase;
  message: string;
}

interface LeaderboardSubmitToastProps {
  toast: LeaderboardSubmitToastState | null;
  onDismiss: () => void;
}

const AUTO_DISMISS_MS = 3500;
const EXIT_MS = 280;

export default function LeaderboardSubmitToast({
  toast,
  onDismiss,
}: LeaderboardSubmitToastProps) {
  const onDismissRef = useRef(onDismiss);
  onDismissRef.current = onDismiss;
  const [exiting, setExiting] = useState(false);

  useEffect(() => {
    setExiting(false);
    if (!toast || toast.phase === "submitting") return;

    const hideId = setTimeout(() => setExiting(true), AUTO_DISMISS_MS);
    return () => clearTimeout(hideId);
  }, [toast]);

  useEffect(() => {
    if (!exiting) return;
    const id = setTimeout(() => onDismissRef.current(), EXIT_MS);
    return () => clearTimeout(id);
  }, [exiting]);

  if (!toast) return null;

  return (
    <div
      className={`lb-submit-banner lb-submit-banner--${toast.phase}${
        exiting ? " lb-submit-banner--out" : ""
      }`}
      role="status"
      aria-live="polite"
    >
      <div className="lb-submit-banner__inner">
        <span className="lb-submit-banner__icon" aria-hidden="true">
          {toast.phase === "submitting" && (
            <span className="lb-submit-banner__spinner" />
          )}
          {toast.phase === "success" && "🏆"}
          {toast.phase === "error" && "!"}
        </span>
        <span className="lb-submit-banner__text">{toast.message}</span>
        {toast.phase !== "submitting" && (
          <button
            type="button"
            className="lb-submit-banner__close"
            onClick={() => {
              setExiting(true);
            }}
            aria-label="Dismiss"
          >
            ✕
          </button>
        )}
      </div>
    </div>
  );
}
