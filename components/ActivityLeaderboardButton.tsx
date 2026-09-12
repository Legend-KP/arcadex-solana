"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { usePlayerProfile } from "@/components/PlayerProfileProvider";
import {
  ActivityLeaderboardEntry,
  getActivityLeaderboard,
  pingActivityVisit,
} from "@/lib/activity-client";
import { formatActivityCountdown } from "@/lib/activity-week";

const MEDALS = ["🥇", "🥈", "🥉"];
const SWIPE_THRESHOLD = 60;

function TrophyIcon() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
    >
      <path
        d="M8 4h8v2.5c0 2.2-1.8 4-4 4s-4-1.8-4-4V4Z"
        fill="#F5C542"
        stroke="#D4A017"
        strokeWidth="1.2"
      />
      <path
        d="M8 4H5.5A2.5 2.5 0 0 0 5.5 9c1.2 0 2.2-.7 2.7-1.7M16 4h2.5A2.5 2.5 0 0 1 18.5 9c-1.2 0-2.2-.7-2.7-1.7"
        stroke="#D4A017"
        strokeWidth="1.4"
        strokeLinecap="round"
      />
      <path
        d="M10 14.5h4M12 10.5V14.5M9 19h6v1.5H9V19Z"
        stroke="#D4A017"
        strokeWidth="1.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export default function ActivityLeaderboardButton() {
  const { walletAddress } = usePlayerProfile();
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [entries, setEntries] = useState<ActivityLeaderboardEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [countdown, setCountdown] = useState("");
  const [endsAt, setEndsAt] = useState(0);
  const [me, setMe] = useState<{
    rank: number | null;
    score: number;
    activeDays: number;
  } | null>(null);
  const touchStartY = useRef<number | null>(null);
  const pingedRef = useRef(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!walletAddress || pingedRef.current) return;
    pingedRef.current = true;
    void pingActivityVisit(walletAddress);
  }, [walletAddress]);

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    getActivityLeaderboard({
      walletAddress: walletAddress || undefined,
      week: "current",
    })
      .then((data) => {
        setEntries(data.entries ?? []);
        setEndsAt(data.endsAtMs || data.endsAt || 0);
        setMe(data.me);
        if (data.resetsIn) setCountdown(data.resetsIn);
      })
      .catch(() => {
        setEntries([]);
        setMe(null);
      })
      .finally(() => setLoading(false));
  }, [open, walletAddress]);

  useEffect(() => {
    if (!open || !endsAt) {
      setCountdown("");
      return;
    }
    const tick = () => {
      setCountdown(formatActivityCountdown(endsAt - Date.now()));
    };
    tick();
    const interval = window.setInterval(tick, 1000);
    return () => window.clearInterval(interval);
  }, [open, endsAt]);

  useEffect(() => {
    if (!open) return;
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    document.addEventListener("keydown", handleKeyDown);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = prevOverflow;
    };
  }, [open]);

  const handleTouchStart = (e: React.TouchEvent) => {
    touchStartY.current = e.touches[0].clientY;
  };

  const handleTouchEnd = (e: React.TouchEvent) => {
    if (touchStartY.current === null) return;
    const delta = e.changedTouches[0].clientY - touchStartY.current;
    touchStartY.current = null;
    if (delta > SWIPE_THRESHOLD) setOpen(false);
  };

  const myWallet = walletAddress?.toLowerCase() ?? "";

  const sheet =
    open && mounted
      ? createPortal(
          <div
            className="lb-backdrop activity-lb-backdrop"
            onClick={() => setOpen(false)}
            role="presentation"
          >
            <div
              className="lb-sheet activity-lb-sheet"
              role="dialog"
              aria-modal="true"
              aria-label="Weekly Activity Leaderboard"
              onClick={(e) => e.stopPropagation()}
              onTouchStart={handleTouchStart}
              onTouchEnd={handleTouchEnd}
            >
              <div className="lb-header">
                <div className="lb-title-wrap">
                  <span className="lb-trophy-hex" aria-hidden="true">
                    🏆
                  </span>
                  <div className="lb-title-stack">
                    <span className="lb-title">Weekly Activity Leaderboard</span>
                    <span className="lb-live-badge">
                      <span className="lb-live-dot" aria-hidden="true" />
                      THIS WEEK
                    </span>
                  </div>
                </div>
                <button
                  type="button"
                  className="lb-close"
                  onClick={() => setOpen(false)}
                  aria-label="Close leaderboard"
                >
                  ✕
                </button>
              </div>

              <p className="activity-lb-hint">
                Come daily and play games to climb the board.
              </p>

              <div className="lb-timer-panel" role="status">
                <div className="lb-timer-panel__glow" aria-hidden="true" />
                <div className="lb-timer-panel__content">
                  <p className="lb-timer-panel__label">Resets in</p>
                  <p className="lb-timer-panel__value">{countdown || "…"}</p>
                </div>
                <div className="lb-timer-panel__trophy" aria-hidden="true">
                  🏆
                </div>
              </div>

              {me && (
                <p className="activity-lb-you">
                  You ·{" "}
                  {me.score > 0 && me.rank != null
                    ? `#${me.rank}`
                    : "Unranked"}{" "}
                  · {me.score.toLocaleString()} XP
                </p>
              )}

              <div className="lb-table-head" aria-hidden="true">
                <span className="lb-table-head__rank">#</span>
                <span className="lb-table-head__player">PLAYER</span>
                <span className="lb-table-head__score">XP</span>
              </div>

              <div className="lb-list">
                {loading && <p className="lb-empty">Loading...</p>}
                {!loading && entries.length === 0 && (
                  <p className="lb-empty">No activity yet — play a game!</p>
                )}
                {!loading &&
                  entries.map((e, i) => {
                    const isYou =
                      Boolean(myWallet) &&
                      e.walletAddress.toLowerCase() === myWallet;
                    return (
                      <div
                        key={`${e.walletAddress}-${i}`}
                        className={`lb-row${i === 0 ? " lb-row--first" : ""}${
                          i < 3 ? " lb-row--podium" : ""
                        }${isYou ? " activity-lb-row--you" : ""}`}
                      >
                        <span
                          className={`lb-pos ${
                            i < 3 ? ["gold", "silver", "bronze"][i] : "other"
                          }`}
                        >
                          {i < 3 ? MEDALS[i] : `#${i + 1}`}
                        </span>
                        <span className="lb-name">
                          {e.name}
                          {isYou ? " (you)" : ""}
                        </span>
                        <span className="lb-score">
                          {e.score.toLocaleString()} XP
                        </span>
                      </div>
                    );
                  })}
              </div>
            </div>
          </div>,
          document.body
        )
      : null;

  return (
    <>
      <button
        type="button"
        className="activity-lb-btn"
        onClick={() => setOpen(true)}
        aria-label="Open weekly activity leaderboard"
      >
        <TrophyIcon />
        <span className="activity-lb-btn__label">Board</span>
      </button>
      {sheet}
    </>
  );
}
