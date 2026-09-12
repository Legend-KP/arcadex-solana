"use client";

import { useEffect, useRef, useState } from "react";
import {
  ContestInfo,
  LEADERBOARD_MAX_ENTRIES,
  LeaderboardEntry,
} from "@/types";
import { usePlayerProfile } from "@/components/PlayerProfileProvider";
import { formatContestCountdown } from "@/lib/contest";
import { getLeaderboard } from "@/lib/leaderboard-client";

export type LeaderboardMode = "default" | "postSubmit";

interface LeaderboardProps {
  gameId: string;
  gameName: string;
  contestLive?: boolean;
  open: boolean;
  mode?: LeaderboardMode;
  onClose: () => void;
}

const MEDALS = ["🥇", "🥈", "🥉"];
const SWIPE_THRESHOLD = 60;

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

function TrophyHexIcon() {
  return (
    <span className="lb-trophy-hex" aria-hidden="true">
      🏆
    </span>
  );
}

export default function Leaderboard({
  gameId,
  gameName,
  contestLive = false,
  open,
  mode = "default",
  onClose,
}: LeaderboardProps) {
  const isPostSubmit = mode === "postSubmit";
  const { walletAddress, playerName } = usePlayerProfile();
  const [entries, setEntries] = useState<LeaderboardEntry[]>([]);
  const [contest, setContest] = useState<ContestInfo | null>(null);
  const [submittedBest, setSubmittedBest] = useState(0);
  const [loading, setLoading] = useState(false);
  const [countdown, setCountdown] = useState("");
  const [detailsOpen, setDetailsOpen] = useState(false);
  const touchStartY = useRef<number | null>(null);

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    setDetailsOpen(false);
    getLeaderboard(gameId, {
      walletAddress: walletAddress || undefined,
      playerName: playerName || undefined,
    })
      .then((data) => {
        setContest(data.contest ?? null);
        if (data.contest?.status === "live") {
          setEntries(data.contest.entries ?? []);
        } else {
          setEntries((data.entries ?? []).slice(0, LEADERBOARD_MAX_ENTRIES));
        }
        setSubmittedBest(data.submittedBest ?? 0);
      })
      .catch(() => {
        setEntries([]);
        setContest(null);
        setSubmittedBest(0);
      })
      .finally(() => setLoading(false));
  }, [open, gameId, walletAddress, playerName]);

  useEffect(() => {
    if (!open || contest?.status !== "live") {
      setCountdown("");
      return;
    }

    const tick = () => {
      setCountdown(formatContestCountdown(contest.endsAt - Date.now()));
    };

    tick();
    const interval = window.setInterval(tick, 1000);
    return () => window.clearInterval(interval);
  }, [open, contest]);

  const handleTouchStart = (e: React.TouchEvent) => {
    touchStartY.current = e.touches[0].clientY;
  };

  const isLiveContest = contest?.status === "live" || (!contest && contestLive);
  const isEndedContest = contest?.status === "ended";
  const showContestBoard = Boolean(contest?.status === "live");
  const showPostSubmit = isPostSubmit && showContestBoard;

  const handleTouchEnd = (e: React.TouchEvent) => {
    if (showPostSubmit) return;
    if (touchStartY.current === null) return;
    const delta = e.changedTouches[0].clientY - touchStartY.current;
    touchStartY.current = null;
    if (delta > SWIPE_THRESHOLD) onClose();
  };

  if (!open) return null;

  return (
    <div
      className="lb-backdrop"
      onClick={showPostSubmit ? undefined : onClose}
      role="presentation"
    >
      <div
        className={`lb-sheet${showPostSubmit ? " lb-sheet--post-submit" : ""}${
          showContestBoard ? " lb-sheet--contest" : ""
        }`}
        role="dialog"
        aria-modal="true"
        aria-label={`${gameName} leaderboard`}
        onClick={(e) => e.stopPropagation()}
        onTouchStart={handleTouchStart}
        onTouchEnd={handleTouchEnd}
      >
        {showPostSubmit && (
          <div className="lb-success-header" role="status">
            <span className="lb-success-header__text">Score submitted!</span>
          </div>
        )}

        <div className="lb-header">
          <div className="lb-title-wrap">
            {!showPostSubmit && <TrophyHexIcon />}
            <div className="lb-title-stack">
              <span className="lb-title">{gameName}</span>
              {showContestBoard && isLiveContest && (
                <span className="lb-live-badge">
                  <span className="lb-live-dot" aria-hidden="true" />
                  CONTEST LIVE
                </span>
              )}
            </div>
          </div>
          {!showPostSubmit && (
            <button
              type="button"
              className="lb-close"
              onClick={onClose}
              aria-label="Close leaderboard"
            >
              ✕
            </button>
          )}
        </div>

        {showContestBoard && isLiveContest && (
          <div className="lb-timer-panel" role="status">
            <div className="lb-timer-panel__glow" aria-hidden="true" />
            <div className="lb-timer-panel__content">
              <p className="lb-timer-panel__label">Time remaining</p>
              <p className="lb-timer-panel__value">
                {countdown || "…"}
              </p>
            </div>
            <div className="lb-timer-panel__trophy" aria-hidden="true">
              🏆
            </div>
          </div>
        )}

        {isEndedContest && (
          <div className="lb-contest-coming-soon" role="status">
            Contest Coming Soon...
          </div>
        )}

        {!showContestBoard && submittedBest > 0 && (
          <p className="lb-submit-hint">
            Your best submitted score: {submittedBest.toLocaleString()}
          </p>
        )}

        {showContestBoard && (
          <div className="lb-table-head" aria-hidden="true">
            <span className="lb-table-head__rank">#</span>
            <span className="lb-table-head__player">PLAYER</span>
            <span className="lb-table-head__score">SCORE</span>
          </div>
        )}

        <div className="lb-list">
          {loading && <p className="lb-empty">Loading...</p>}
          {!loading && entries.length === 0 && (
            <p className="lb-empty">
              {showContestBoard
                ? "No contest scores yet — be the first!"
                : "No scores yet — be the first!"}
            </p>
          )}
          {!loading &&
            entries.map((e, i) => (
              <div
                key={`${e.walletAddress ?? e.name}-${i}`}
                className={`lb-row${i === 0 ? " lb-row--first" : ""}${
                  i < 3 ? " lb-row--podium" : ""
                }${showContestBoard ? " lb-row--contest" : ""}`}
              >
                <span
                  className={`lb-pos ${
                    i < 3 ? ["gold", "silver", "bronze"][i] : "other"
                  }`}
                >
                  {i < 3 ? MEDALS[i] : `#${i + 1}`}
                </span>
                <span className="lb-name">{e.name}</span>
                <span className="lb-score">
                  {showContestBoard && <CoinIcon />}
                  {e.score.toLocaleString()}
                </span>
              </div>
            ))}
        </div>

        {showContestBoard && !loading && (
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
              {entries.length} Total Participants
            </span>
          </div>
        )}

        {showContestBoard && contest?.task && (
          <div className="lb-howto">
            <div className="lb-howto__icon" aria-hidden="true">
              🎁
            </div>
            <div className="lb-howto__body">
              <p className="lb-howto__text">
                <strong>How it works:</strong>{" "}
                {detailsOpen
                  ? contest.task
                  : contest.task.length > 72
                    ? `${contest.task.slice(0, 72).trimEnd()}…`
                    : contest.task}
              </p>
              {contest.task.length > 72 && (
                <button
                  type="button"
                  className="lb-howto__btn"
                  onClick={() => setDetailsOpen((v) => !v)}
                >
                  {detailsOpen ? "Hide Details" : "View Details"}
                </button>
              )}
            </div>
          </div>
        )}

        {showPostSubmit && (
          <button
            type="button"
            className="lb-continue-btn"
            onClick={onClose}
          >
            Continue
          </button>
        )}
      </div>
    </div>
  );
}
