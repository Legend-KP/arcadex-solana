"use client";

import { useEffect, useState } from "react";
import { usePlayerProfile } from "@/components/PlayerProfileProvider";
import {
  ActivityLeaderboardEntry,
  getActivityLeaderboard,
} from "@/lib/activity-client";
import { formatActivityCountdown } from "@/lib/activity-week";

const MEDALS = ["🥇", "🥈", "🥉"];

export default function ActivityLeaderboardPanel() {
  const { walletAddress } = usePlayerProfile();
  const [entries, setEntries] = useState<ActivityLeaderboardEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [countdown, setCountdown] = useState("");
  const [endsAt, setEndsAt] = useState(0);
  const [me, setMe] = useState<{
    rank: number | null;
    score: number;
    activeDays: number;
  } | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    getActivityLeaderboard({
      walletAddress: walletAddress || undefined,
      week: "current",
    })
      .then((data) => {
        if (cancelled) return;
        setEntries(data.entries ?? []);
        setEndsAt(data.endsAtMs || data.endsAt || 0);
        setMe(data.me);
        if (data.resetsIn) setCountdown(data.resetsIn);
      })
      .catch(() => {
        if (cancelled) return;
        setEntries([]);
        setMe(null);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [walletAddress]);

  useEffect(() => {
    if (!endsAt) return;
    const tick = () => setCountdown(formatActivityCountdown(endsAt - Date.now()));
    tick();
    const interval = window.setInterval(tick, 1000);
    return () => window.clearInterval(interval);
  }, [endsAt]);

  const myWallet = walletAddress?.toLowerCase() ?? "";

  return (
    <section className="activity-board" aria-label="Weekly Activity Leaderboard">
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
      <p className="activity-lb-hint">Come daily and play games to climb the board.</p>
      <div className="lb-timer-panel" role="status">
        <div className="lb-timer-panel__content">
          <p className="lb-timer-panel__label">Resets in</p>
          <p className="lb-timer-panel__value">{countdown || "…"}</p>
        </div>
      </div>
      {me && (
        <p className="activity-lb-you">
          You · {me.score > 0 && me.rank != null ? `#${me.rank}` : "Unranked"} ·{" "}
          {me.score.toLocaleString()} XP
        </p>
      )}
      <div className="lb-list">
        {loading && <p className="lb-empty">Loading...</p>}
        {!loading && entries.length === 0 && (
          <p className="lb-empty">No activity yet — play a game!</p>
        )}
        {!loading &&
          entries.map((entry, index) => {
            const isYou =
              Boolean(myWallet) && entry.walletAddress.toLowerCase() === myWallet;
            return (
              <div
                key={`${entry.walletAddress}-${index}`}
                className={`lb-row${index < 3 ? " lb-row--podium" : ""}${
                  isYou ? " activity-lb-row--you" : ""
                }`}
              >
                <span className={`lb-pos ${index < 3 ? ["gold", "silver", "bronze"][index] : "other"}`}>
                  {index < 3 ? MEDALS[index] : `#${index + 1}`}
                </span>
                <span className="lb-name">
                  {entry.name}
                  {isYou ? " (you)" : ""}
                </span>
                <span className="lb-score">{entry.score.toLocaleString()} XP</span>
              </div>
            );
          })}
      </div>
    </section>
  );
}
