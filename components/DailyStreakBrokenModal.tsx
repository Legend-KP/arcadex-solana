"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { playTouchSfx } from "@/lib/sfx";

interface DailyStreakBrokenModalProps {
  open: boolean;
  previousDays: number;
  onContinue: () => void;
}

function FlameIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M12 2c1.5 3.2-.2 5.2-1.6 6.7C8.8 10.3 8 12 8 14.2 8 17.4 10.2 20 13 20c2.6 0 4.7-2 4.9-4.6.2-2.2-.8-3.6-1.7-4.7-.5-.6-.9-1.2-1-2-.1 1.4.5 2.5 1.1 3.4 1.4 2 1.7 3.5 1.6 4.9C17.7 20.3 15.1 22.5 12 22.5 8.1 22.5 5 19.3 5 15.2c0-2.6 1.1-4.5 2.5-6C9 7.5 10.4 5.6 12 2z"
        fill="currentColor"
      />
    </svg>
  );
}

export default function DailyStreakBrokenModal({
  open,
  previousDays,
  onContinue,
}: DailyStreakBrokenModalProps) {
  const startDays = Math.max(0, Math.floor(previousDays));
  const [displayDays, setDisplayDays] = useState(startDays);
  const [flipping, setFlipping] = useState(false);
  const [phase, setPhase] = useState<"count" | "message">("count");
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!open) {
      setDisplayDays(startDays);
      setFlipping(false);
      setPhase("count");
      return;
    }

    setDisplayDays(startDays);
    setFlipping(false);
    setPhase("count");

    const reduceMotion =
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    if (reduceMotion || startDays <= 0) {
      setDisplayDays(0);
      setPhase("message");
      return;
    }

    let cancelled = false;
    let step = startDays;
    const timers: number[] = [];

    // Brief hold on the old streak, then flip down to zero.
    timers.push(
      window.setTimeout(() => {
        const tick = () => {
          if (cancelled) return;
          setFlipping(true);
          timers.push(
            window.setTimeout(() => {
              if (cancelled) return;
              step -= 1;
              setDisplayDays(step);
              setFlipping(false);
              if (step <= 0) {
                timers.push(
                  window.setTimeout(() => {
                    if (!cancelled) setPhase("message");
                  }, 280)
                );
                return;
              }
              timers.push(window.setTimeout(tick, 220));
            }, 320)
          );
        };
        tick();
      }, 700)
    );

    return () => {
      cancelled = true;
      for (const id of timers) window.clearTimeout(id);
    };
  }, [open, startDays]);

  useEffect(() => {
    if (!open) return;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prevOverflow;
    };
  }, [open]);

  if (!open || !mounted || typeof document === "undefined") return null;

  const dayLabel = displayDays === 1 ? "day" : "days";

  return createPortal(
    <div
      className="player-modal-backdrop streak-broken-backdrop"
      role="dialog"
      aria-modal="true"
      aria-labelledby="streak-broken-title"
    >
      <div className="player-modal streak-broken-modal">
        <div
          className={`streak-broken-flame${
            phase === "message" ? " streak-broken-flame--soft" : ""
          }`}
          aria-hidden
        >
          <FlameIcon />
        </div>

        <p className="streak-broken-label">Your streak</p>

        <div className="streak-broken-flip-stage" aria-live="polite">
          <div
            key={displayDays}
            className={`streak-broken-flip-card${
              flipping ? " streak-broken-flip-card--out" : " streak-broken-flip-card--in"
            }`}
          >
            <span className="streak-broken-num">{displayDays}</span>
          </div>
        </div>

        <p className="streak-broken-unit">
          {displayDays === 0 ? "ready for day 1" : `${dayLabel} strong`}
        </p>

        <div
          className={`streak-broken-copy${
            phase === "message" ? " streak-broken-copy--visible" : ""
          }`}
        >
          <h2 id="streak-broken-title" className="streak-broken-title">
            Fresh start
          </h2>
          <p className="streak-broken-message">
            That run paused — it happens. Check in today and build a new one.
          </p>
        </div>

        <button
          type="button"
          className="streak-broken-btn"
          onClick={() => {
            playTouchSfx();
            onContinue();
          }}
          disabled={phase !== "message"}
        >
          Start fresh
        </button>
      </div>
    </div>,
    document.body
  );
}
