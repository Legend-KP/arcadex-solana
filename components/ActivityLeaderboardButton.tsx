"use client";

import { useEffect, useState } from "react";
import { usePlayerProfile } from "@/components/PlayerProfileProvider";
import {
  ActivityLeaderboardEntry,
  getActivityLeaderboard,
} from "@/lib/activity-client";
import { formatActivityCountdown } from "@/lib/activity-week";

const MEDALS = ["🥇", "🥈", "🥉"];

function CoinIcon() {
  return (
    <svg
      className="lb-coin-icon"
      width="16"
      height="16"
      viewBox="0 0 16 16"
      aria-hidden="true"
    >
      <circle cx="8" cy="8" r="7" fill="#F5C542" stroke="#D4A017" strokeWidth="1.2" />
      <circle cx="8" cy="8" r="4.5" fill="none" stroke="#E8B923" strokeWidth="0.8" />
      <text
        x="8"
        y="10.5"
        textAnchor="middle"
        fontSize="7"
        fontWeight="700"
        fill="#9A7209"
      >
        $
      </text>
    </svg>
  );
}

export default function ActivityLeaderboardPanel() {
  const { walletAddress } = usePlayerProfile();
  const [entries, setEntries] = useState<ActivityLeaderboardEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [countdown, setCountdown] = useState("");
  const [endsAt, setEndsAt] = useState(0);
  const [totalParticipants, setTotalParticipants] = useState(0);
  const [error, setError] = useState("");
  const [me, setMe] = useState<{
    rank: number | null;
    score: number;
    activeDays: number;
  } | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError("");
    getActivityLeaderboard({
      walletAddress: walletAddress || undefined,
      week: "current",
    })
      .then((data) => {
        if (cancelled) return;
        setEntries(data.entries ?? []);
        setEndsAt(data.endsAtMs || data.endsAt || 0);
        setMe(data.me);
        setTotalParticipants(
          Math.max(data.totalParticipants ?? 0, data.entries?.length ?? 0)
        );
        if (data.resetsIn) setCountdown(data.resetsIn);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setEntries([]);
        setMe(null);
        setTotalParticipants(0);
        setError(
          err instanceof Error ? err.message : "Could not load Weekly XP Board."
        );
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
    <section
      className="activity-board activity-board--contest"
      aria-label="Weekly XP Board"
    >
      <div className="activity-board__card lb-sheet lb-sheet--contest">
        <div className="lb-header">
          <div className="lb-title-wrap">
            <span className="lb-trophy-hex" aria-hidden="true">
              🏆
            </span>
            <div className="lb-title-stack">
              <span className="lb-title">Weekly XP Board</span>
              <span className="lb-live-badge">
                <span className="lb-live-dot" aria-hidden="true" />
                CONTEST LIVE
              </span>
            </div>
          </div>
        </div>

        <div className="lb-timer-panel" role="status">
          <div className="lb-timer-panel__glow" aria-hidden="true" />
          <div className="lb-timer-panel__content">
            <p className="lb-timer-panel__label">Time remaining</p>
            <p className="lb-timer-panel__value">{countdown || "…"}</p>
          </div>
          <div className="lb-timer-panel__trophy" aria-hidden="true">
            🏆
          </div>
        </div>

        {me && (
          <p className="activity-lb-you">
            You · {me.score > 0 && me.rank != null ? `#${me.rank}` : "Unranked"} ·{" "}
            {me.score.toLocaleString()} XP
          </p>
        )}

        <div className="lb-table-head" aria-hidden="true">
          <span className="lb-table-head__rank">#</span>
          <span className="lb-table-head__player">PLAYER</span>
          <span className="lb-table-head__score">SCORE</span>
        </div>

        <div className="lb-list">
          {loading && <p className="lb-empty">Loading...</p>}
          {!loading && error && <p className="lb-empty">{error}</p>}
          {!loading && !error && entries.length === 0 && (
            <p className="lb-empty">
              No XP yet this week — play a game or check in.
            </p>
          )}
          {!loading &&
            !error &&
            entries.map((entry, index) => {
              const isYou =
                Boolean(myWallet) &&
                entry.walletAddress.toLowerCase() === myWallet;
              return (
                <div
                  key={`${entry.walletAddress}-${index}`}
                  className={`lb-row lb-row--contest${
                    index === 0 ? " lb-row--first" : ""
                  }${index < 3 ? " lb-row--podium" : ""}${
                    isYou ? " activity-lb-row--you" : ""
                  }`}
                >
                  <span
                    className={`lb-pos ${
                      index < 3 ? ["gold", "silver", "bronze"][index] : "other"
                    }`}
                  >
                    {index < 3 ? MEDALS[index] : `#${index + 1}`}
                  </span>
                  <span className="lb-name">
                    {entry.name}
                    {isYou ? " (you)" : ""}
                  </span>
                  <span className="lb-score">
                    <CoinIcon />
                    {entry.score.toLocaleString()}
                  </span>
                </div>
              );
            })}
        </div>

        {!loading && (
          <div className="lb-stats-bar">
            <span className="lb-stats-bar__item">
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                aria-hidden="true"
              >
                <path
                  d="M16 11a4 4 0 1 0-8 0 4 4 0 0 0 8 0ZM4 19a6 6 0 0 1 12 0M15 8a3.5 3.5 0 1 1 5.5 2.9A5 5 0 0 1 22 19"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
              {totalParticipants} Total Participants
            </span>
          </div>
        )}

        <div className="lb-howto">
          <div className="lb-howto__icon" aria-hidden="true">
            🎁
          </div>
          <div className="lb-howto__body">
            <p className="lb-howto__text">
              <strong>How it works: Top 10 Wins it All</strong>
              <br />
              Weekly board resets every Monday 00:00 UTC. Play games or check in
              to earn XP and climb. 100% of the fees generated goes into the rewards!
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}
