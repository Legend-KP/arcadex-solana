"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { formatWalletError } from "@/lib/format-wallet-error";
import { playSuccessSfx, playTouchSfx } from "@/lib/sfx";
import {
  fetchStreakStatus,
  grantStreakReward,
  performDailyCheckIn,
  refreshSessionFromCheckIn,
  type StreakStatus,
} from "@/lib/streak-client";

const DAILY_XP = 10;

interface DailyCheckInModalProps {
  open: boolean;
  walletAddress: string;
  status: StreakStatus | null;
  onComplete: (result: {
    day: number;
    milestone: boolean;
    infiniteSparkGranted: boolean;
  }) => void;
  onClose?: () => void;
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

function CheckIcon() {
  return (
    <svg viewBox="0 0 20 20" fill="none" aria-hidden>
      <path
        d="M5 10.5 8.2 14 15 6.5"
        stroke="#fff"
        strokeWidth="2.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg viewBox="0 0 20 20" fill="none" aria-hidden>
      <path
        d="M5 5l10 10M15 5 5 15"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </svg>
  );
}

function CalendarIcon() {
  return (
    <svg viewBox="0 0 20 20" fill="none" aria-hidden>
      <rect
        x="3"
        y="4"
        width="14"
        height="13"
        rx="2"
        stroke="currentColor"
        strokeWidth="1.5"
      />
      <path
        d="M3 8h14M7 2.5v3M13 2.5v3"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
    </svg>
  );
}

/** Gold XP coin — used for D1–D6. */
function XpCoinIcon({ uid }: { uid: string }) {
  const outer = `xp-outer-${uid}`;
  const inner = `xp-inner-${uid}`;
  return (
    <svg viewBox="0 0 40 40" fill="none" aria-hidden>
      <circle cx="20" cy="20" r="18" fill={`url(#${outer})`} />
      <circle cx="20" cy="20" r="14.5" fill={`url(#${inner})`} />
      <circle
        cx="20"
        cy="20"
        r="14.5"
        stroke="#fde68a"
        strokeWidth="1.2"
        opacity="0.7"
      />
      <text
        x="20"
        y="24.5"
        textAnchor="middle"
        fontSize="11"
        fontWeight="800"
        fill="#7c2d12"
        fontFamily="system-ui, sans-serif"
      >
        XP
      </text>
      <defs>
        <linearGradient id={outer} x1="6" y1="4" x2="34" y2="36">
          <stop stopColor="#fde68a" />
          <stop offset="0.45" stopColor="#f59e0b" />
          <stop offset="1" stopColor="#b45309" />
        </linearGradient>
        <linearGradient id={inner} x1="10" y1="8" x2="30" y2="32">
          <stop stopColor="#fbbf24" />
          <stop offset="1" stopColor="#d97706" />
        </linearGradient>
      </defs>
    </svg>
  );
}

function InfinitySparkIcon({ gradientId }: { gradientId: string }) {
  return (
    <svg viewBox="0 0 40 40" fill="none" aria-hidden>
      <circle cx="20" cy="20" r="18" fill={`url(#${gradientId})`} />
      <path
        d="M22.5 8.5 12.8 21.2h6.2l-1.5 10.3 9.7-12.7h-6.2L22.5 8.5z"
        fill="#fff"
      />
      <circle cx="31" cy="10" r="7" fill="#4c1d95" />
      <text
        x="31"
        y="13.2"
        textAnchor="middle"
        fontSize="9"
        fontWeight="800"
        fill="#fff"
        fontFamily="system-ui, sans-serif"
      >
        ∞
      </text>
      <defs>
        <linearGradient id={gradientId} x1="6" y1="6" x2="34" y2="34">
          <stop stopColor="#fb923c" />
          <stop offset="0.55" stopColor="#f59e0b" />
          <stop offset="1" stopColor="#ea580c" />
        </linearGradient>
      </defs>
    </svg>
  );
}

function ShieldCheckIcon() {
  return (
    <svg viewBox="0 0 20 20" fill="none" aria-hidden>
      <path
        d="M10 2.5 16 5v4.8c0 3.7-2.4 6.2-6 7.7-3.6-1.5-6-4-6-7.7V5l6-2.5z"
        fill="rgba(255,255,255,0.28)"
        stroke="#fff"
        strokeWidth="1.2"
      />
      <path
        d="M7.2 10.1 9.1 12l3.8-4.2"
        stroke="#fff"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function dayNodeState(
  day: number,
  currentDay: number,
  checkInDay: number,
  wouldReset: boolean
): "done" | "today" | "upcoming" {
  if (wouldReset) {
    return day === 1 ? "today" : "upcoming";
  }
  if (currentDay >= day) return "done";
  if (checkInDay === day) return "today";
  return "upcoming";
}

export default function DailyCheckInModal({
  open,
  walletAddress,
  status,
  onComplete,
  onClose,
}: DailyCheckInModalProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState<{
    title: string;
    body: string;
  } | null>(null);
  const pendingCompleteRef = useRef<{
    day: number;
    milestone: boolean;
    infiniteSparkGranted: boolean;
  } | null>(null);
  const infinityGradId = useId().replace(/:/g, "");
  const daysRailRef = useRef<HTMLDivElement | null>(null);
  const recoverAttemptedRef = useRef(false);

  useEffect(() => {
    if (!open || !walletAddress || recoverAttemptedRef.current) return;
    recoverAttemptedRef.current = true;

    let cancelled = false;
    (async () => {
      try {
        const fresh = await fetchStreakStatus(walletAddress, undefined, {
          fresh: true,
        });
        if (cancelled || fresh.canCheckIn) return;

        setLoading(true);
        await refreshSessionFromCheckIn(walletAddress);
        if (cancelled) return;
        onComplete({
          day: fresh.currentDay,
          milestone: false,
          infiniteSparkGranted: false,
        });
      } catch {
        // Still need a check-in / user action
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [open, walletAddress, onComplete]);

  useEffect(() => {
    if (!open) {
      recoverAttemptedRef.current = false;
      setSuccess(null);
      pendingCompleteRef.current = null;
      setError("");
    }
  }, [open]);

  const finishSuccess = useCallback(() => {
    const pending = pendingCompleteRef.current;
    pendingCompleteRef.current = null;
    setSuccess(null);
    if (pending) onComplete(pending);
  }, [onComplete]);

  useEffect(() => {
    if (!success) return;
    const id = window.setTimeout(() => finishSuccess(), 4000);
    return () => window.clearTimeout(id);
  }, [success, finishSuccess]);

  if (!open || typeof document === "undefined") return null;

  const requiredDays = status?.requiredDays ?? 7;
  const currentDay = status?.currentDay ?? 0;
  const wouldReset = Boolean(status?.streakWouldReset);
  const checkInDay = wouldReset
    ? 1
    : currentDay === 0
      ? 1
      : Math.min(currentDay + 1, requiredDays);
  const displayStreak = wouldReset ? 0 : currentDay;
  const isFinalDay = checkInDay >= requiredDays;
  const days = Array.from({ length: requiredDays }, (_, i) => i + 1);
  const progressRatio =
    requiredDays <= 1
      ? displayStreak > 0
        ? 1
        : 0
      : Math.min(1, Math.max(0, displayStreak / (requiredDays - 1)));

  const streakHint = wouldReset
    ? "Ready for a fresh run — check in to begin day 1."
    : displayStreak <= 0
      ? "Check in today to begin your 7-day run."
      : isFinalDay
        ? "Final check-in unlocks Infinite Spark!"
        : displayStreak === 1
          ? "Nice! Come back tomorrow 🔥"
          : "Good start! Keep it going! 🔥";

  const nextMilestoneDay = isFinalDay
    ? requiredDays
    : Math.min(requiredDays, checkInDay);
  const nextIsInfinite = nextMilestoneDay >= requiredDays;
  const nextRewardTitle = nextIsInfinite
    ? `Day ${requiredDays}`
    : `Day ${nextMilestoneDay}`;
  const nextRewardDetail = nextIsInfinite
    ? "Infinite Spark · 24 hours"
    : `${DAILY_XP} XP`;
  const nextRewardBadge = isFinalDay
    ? "Today"
    : displayStreak > 0
      ? `${requiredDays - displayStreak} days left`
      : `Day ${requiredDays}`;

  async function handleCheckIn() {
    playTouchSfx();
    setLoading(true);
    setError("");
    try {
      const result = await performDailyCheckIn(walletAddress);
      let infiniteSparkGranted = Boolean(result.infiniteSparkGranted);
      if (result.milestone && !infiniteSparkGranted) {
        try {
          const granted = await grantStreakReward(walletAddress);
          infiniteSparkGranted = Boolean(granted.granted);
        } catch {
          // milestone recorded; grant can be retried
        }
      }
      playSuccessSfx();
      const xp = result.xpGranted || DAILY_XP;
      const complete = {
        day: result.currentDay,
        milestone: result.milestone,
        infiniteSparkGranted,
      };
      pendingCompleteRef.current = complete;
      setSuccess({
        title: complete.infiniteSparkGranted
          ? "Milestone reached!"
          : "Check-in successful!",
        body: complete.infiniteSparkGranted
          ? `+${xp} XP earned. Infinite Spark is active for 24 hours!`
          : `+${xp} XP earned. Day ${complete.day} locked in — come back tomorrow!`,
      });
    } catch (err) {
      setError(formatWalletError(err) || "Check-in failed. Try again.");
    } finally {
      setLoading(false);
    }
  }

  function scrollDays(dir: -1 | 1) {
    const el = daysRailRef.current;
    if (!el) return;
    el.scrollBy({ left: dir * 120, behavior: "smooth" });
  }

  function scrollToRewards() {
    daysRailRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }

  return createPortal(
    <>
      <div className="player-modal-backdrop" role="dialog" aria-modal="true">
        <div className="player-modal daily-checkin-modal">
          <header className="daily-checkin-topbar">
            <button
              type="button"
              className="daily-checkin-icon-btn"
              aria-label="Close"
              onClick={() => {
                playTouchSfx();
                onClose?.();
              }}
            >
              <CloseIcon />
            </button>
            <span className="daily-checkin-brand">ArcadeX</span>
            <span className="daily-checkin-topbar-spacer" aria-hidden />
          </header>

          <h2 className="daily-checkin-heading">
            <FlameIcon className="daily-checkin-heading-flame" />
            Daily Streak
            <FlameIcon className="daily-checkin-heading-flame" />
          </h2>
          <p className="daily-checkin-sub">
            Check in once per day (resets 00:00 UTC) to keep your streak alive and
            earn{" "}
            <span className="daily-checkin-sub-accent">XP &amp; Infinite Spark.</span>
          </p>

          <section className="daily-checkin-board">
            <div
              className="daily-checkin-days-rail"
              ref={daysRailRef}
              aria-label={`${requiredDays}-day streak rewards`}
            >
              {days.map((day) => {
                const state = dayNodeState(
                  day,
                  currentDay,
                  checkInDay,
                  wouldReset
                );
                const isMilestone = day === requiredDays;
                return (
                  <div
                    key={day}
                    className={`daily-checkin-day-card daily-checkin-day-card--${state}${
                      isMilestone ? " daily-checkin-day-card--milestone" : ""
                    }`}
                  >
                    <span className="daily-checkin-day-card-label">D{day}</span>
                    <span className="daily-checkin-day-card-icon" aria-hidden>
                      {state === "done" ? (
                        <span className="daily-checkin-check-badge">
                          <CheckIcon />
                        </span>
                      ) : isMilestone ? (
                        <InfinitySparkIcon gradientId={`inf-${infinityGradId}-${day}`} />
                      ) : (
                        <XpCoinIcon uid={`${infinityGradId}-d${day}`} />
                      )}
                    </span>
                    <span className="daily-checkin-day-card-reward">
                      {isMilestone ? "∞ Spark" : `${DAILY_XP} XP`}
                    </span>
                    {state === "today" ? (
                      <span className="daily-checkin-day-today">Today</span>
                    ) : (
                      <span className="daily-checkin-day-card-spacer" />
                    )}
                  </div>
                );
              })}
            </div>

            <div className="daily-checkin-progress" aria-hidden>
              <div className="daily-checkin-progress-track">
                <div
                  className="daily-checkin-progress-fill"
                  style={{ width: `${progressRatio * 100}%` }}
                />
                {days.map((day) => {
                  const state = dayNodeState(
                    day,
                    currentDay,
                    checkInDay,
                    wouldReset
                  );
                  return (
                    <span
                      key={day}
                      className={`daily-checkin-progress-node daily-checkin-progress-node--${state}`}
                      style={{
                        left: `${((day - 1) / Math.max(1, requiredDays - 1)) * 100}%`,
                      }}
                    >
                      {state === "done" ? <CheckIcon /> : null}
                    </span>
                  );
                })}
              </div>
            </div>

            <div className="daily-checkin-rail-nav">
              <button
                type="button"
                className="daily-checkin-nav-btn"
                aria-label="Previous days"
                onClick={() => scrollDays(-1)}
              >
                ‹
              </button>
              <span className="daily-checkin-rail-hint">
                Swipe to view all {requiredDays} days
              </span>
              <button
                type="button"
                className="daily-checkin-nav-btn"
                aria-label="Next days"
                onClick={() => scrollDays(1)}
              >
                ›
              </button>
            </div>

            <div className="daily-checkin-milestone-row">
              <div className="daily-checkin-milestone-left">
                <p className="daily-checkin-section-label daily-checkin-section-label--light">
                  <CalendarIcon /> Next milestone
                </p>
                <div className="daily-checkin-milestone-reward">
                  <span className="daily-checkin-milestone-icon" aria-hidden>
                    {nextIsInfinite ? (
                      <InfinitySparkIcon gradientId={`inf-ms-${infinityGradId}`} />
                    ) : (
                      <XpCoinIcon uid={`${infinityGradId}-ms`} />
                    )}
                  </span>
                  <div>
                    <p className="daily-checkin-reward-title">{nextRewardTitle}</p>
                    <p className="daily-checkin-reward-detail">{nextRewardDetail}</p>
                  </div>
                  <span className="daily-checkin-reward-badge">{nextRewardBadge}</span>
                </div>
              </div>
              <button
                type="button"
                className="daily-checkin-view-all"
                onClick={scrollToRewards}
              >
                View All Rewards →
              </button>
            </div>
          </section>

          <section className="daily-checkin-hero-card">
            <div className="daily-checkin-hero-copy">
              <p className="daily-checkin-section-label daily-checkin-section-label--light">
                Your streak
              </p>
              <p className="daily-checkin-streak-value">
                {displayStreak > 0 ? (
                  <>
                    <span className="daily-checkin-streak-num">
                      {displayStreak}
                    </span>{" "}
                    <span className="daily-checkin-streak-unit">
                      Day{displayStreak === 1 ? "" : "s"}
                    </span>
                  </>
                ) : (
                  <span className="daily-checkin-streak-unit">Start today</span>
                )}
              </p>
              <p className="daily-checkin-streak-hint">{streakHint}</p>
            </div>
          </section>

          {error ? <p className="daily-checkin-error">{error}</p> : null}

          <button
            type="button"
            className="daily-checkin-btn"
            disabled={loading || !walletAddress || Boolean(success)}
            onClick={() => void handleCheckIn()}
          >
            <span className="daily-checkin-btn-main">
              <ShieldCheckIcon />
              {loading ? "Checking in…" : "Daily Check-in"}
            </span>
          </button>
        </div>
      </div>
      {success ? (
        <div
          className="spark-success-backdrop"
          role="presentation"
          onClick={() => finishSuccess()}
        >
          <div
            className="spark-success-popup"
            role="alertdialog"
            aria-live="polite"
            aria-labelledby="daily-streak-success-title"
            onClick={(e) => e.stopPropagation()}
          >
            <span className="spark-success-popup__icon" aria-hidden>
              ✓
            </span>
            <h3
              id="daily-streak-success-title"
              className="spark-success-popup__title"
            >
              {success.title}
            </h3>
            <p className="spark-success-popup__body">{success.body}</p>
            <button
              type="button"
              className="spark-success-popup__btn"
              onClick={() => finishSuccess()}
            >
              Great!
            </button>
          </div>
        </div>
      ) : null}
    </>,
    document.body
  );
}
