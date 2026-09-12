"use client";

import { useEffect, useState } from "react";
import {
  CONTEST_DURATION_OPTIONS,
  ContestDurationDays,
  ContestInfo,
  Game,
  LeaderboardEntry,
} from "@/types";
import { updateAdminGame } from "@/lib/admin-api";
import {
  computeContestEndsAt,
  formatContestCountdown,
  getContestStatus,
} from "@/lib/contest";
import { getLeaderboard } from "@/lib/leaderboard-client";

interface AdminContestModalProps {
  game: Game | null;
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
  showToast: (message: string) => void;
}

function formatWallet(wallet?: string): string {
  if (!wallet) return "Unknown";
  return wallet;
}

export default function AdminContestModal({
  game,
  open,
  onClose,
  onSaved,
  showToast,
}: AdminContestModalProps) {
  const [durationDays, setDurationDays] = useState<ContestDurationDays>(1);
  const [task, setTask] = useState("");
  const [saving, setSaving] = useState(false);
  const [loadingContest, setLoadingContest] = useState(false);
  const [contestInfo, setContestInfo] = useState<ContestInfo | null>(null);
  const [countdown, setCountdown] = useState("");

  const contestStatus = game ? getContestStatus(game) : null;
  const isLive = contestStatus === "live";
  const isEnded = contestStatus === "ended";
  const isPlanning = !contestStatus || isEnded;

  useEffect(() => {
    if (!open || !game) return;

    setDurationDays(game.contestDurationDays ?? 1);
    setTask(game.contestTask ?? "");
    setContestInfo(null);

    if (game.contestStartedAt) {
      setLoadingContest(true);
      getLeaderboard(game.id)
        .then((data) => setContestInfo(data.contest ?? null))
        .catch(() => setContestInfo(null))
        .finally(() => setLoadingContest(false));
    }
  }, [open, game]);

  useEffect(() => {
    if (!open || !isLive || !game?.contestEndsAt) {
      setCountdown("");
      return;
    }

    const tick = () => {
      setCountdown(formatContestCountdown(game.contestEndsAt! - Date.now()));
    };

    tick();
    const interval = window.setInterval(tick, 1000);
    return () => window.clearInterval(interval);
  }, [open, isLive, game?.contestEndsAt]);

  if (!open || !game) return null;

  async function handleStartContest() {
    if (!task.trim()) {
      showToast("Add a contest task before starting.");
      return;
    }

    setSaving(true);
    try {
      const now = Date.now();
      await updateAdminGame(game!.id, {
        contestDurationDays: durationDays,
        contestTask: task.trim(),
        contestStartedAt: now,
        contestEndsAt: computeContestEndsAt(now, durationDays),
        contestLive: true,
      });
      showToast("Contest started!");
      onSaved();
      onClose();
    } catch (err) {
      showToast(
        err instanceof Error ? err.message : "Failed to start contest."
      );
    } finally {
      setSaving(false);
    }
  }

  async function handleSaveEdit() {
    if (!task.trim()) {
      showToast("Contest task cannot be empty.");
      return;
    }
    if (!game?.contestStartedAt) return;

    setSaving(true);
    try {
      await updateAdminGame(game.id, {
        contestDurationDays: durationDays,
        contestTask: task.trim(),
        contestEndsAt: computeContestEndsAt(game.contestStartedAt, durationDays),
        contestLive: true,
      });
      showToast("Contest updated!");
      onSaved();
      onClose();
    } catch (err) {
      showToast(
        err instanceof Error ? err.message : "Failed to update contest."
      );
    } finally {
      setSaving(false);
    }
  }

  const topEntries: LeaderboardEntry[] = contestInfo?.entries ?? [];

  return (
    <div className="admin-modal-backdrop" onClick={onClose} role="presentation">
      <div
        className="admin-modal"
        role="dialog"
        aria-modal="true"
        aria-label={`Contest panel for ${game.name}`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="admin-modal-header">
          <div>
            <h3 className="admin-modal-title">Contest Panel</h3>
            <p className="admin-modal-subtitle">{game.name}</p>
          </div>
          <button
            type="button"
            className="admin-modal-close"
            onClick={onClose}
            aria-label="Close contest panel"
          >
            ✕
          </button>
        </div>

        {isLive && (
          <div className="admin-contest-live-banner">
            <span>Contest is live</span>
            {countdown && <span className="admin-contest-countdown">{countdown}</span>}
          </div>
        )}

        {isEnded && (
          <div className="admin-contest-ended-banner">
            Contest ended — review final standings or start a new one.
          </div>
        )}

        {isEnded && (
          <div className="admin-contest-results">
            <h4 className="admin-contest-section-title">Final Top 10</h4>
            {loadingContest && <p className="admin-contest-muted">Loading results...</p>}
            {!loadingContest && topEntries.length === 0 && (
              <p className="admin-contest-muted">No contest submissions recorded.</p>
            )}
            {!loadingContest &&
              topEntries.map((entry, index) => (
                <div key={`${entry.walletAddress ?? entry.name}-${index}`} className="admin-contest-result-row">
                  <span className="admin-contest-result-rank">#{index + 1}</span>
                  <span className="admin-contest-result-wallet">
                    {formatWallet(entry.walletAddress)}
                  </span>
                  <span className="admin-contest-result-score">
                    {entry.score.toLocaleString()}
                  </span>
                </div>
              ))}
          </div>
        )}

        {(isPlanning || isLive) && (
          <div className="admin-contest-form">
            <h4 className="admin-contest-section-title">
              {isLive ? "Edit Contest" : "Plan Contest"}
            </h4>

            <label className="form-label">Duration</label>
            <div className="admin-duration-grid">
              {CONTEST_DURATION_OPTIONS.map((days) => (
                <button
                  key={days}
                  type="button"
                  className={`admin-duration-btn${durationDays === days ? " selected" : ""}`}
                  onClick={() => setDurationDays(days)}
                >
                  {days}d
                </button>
              ))}
            </div>
            <p className="admin-contest-hint">
              {durationDays === 1 && "Leaderboard countdown: 24 hours"}
              {durationDays === 2 && "Leaderboard countdown: 48 hours"}
              {durationDays === 4 && "Leaderboard countdown: 96 hours"}
              {durationDays === 7 && "Leaderboard countdown: 168 hours"}
            </p>

            <label className="form-label" htmlFor="contest-task">
              Contest Task
            </label>
            <textarea
              id="contest-task"
              className="form-input admin-contest-textarea"
              placeholder="Describe the contest challenge shown on the leaderboard..."
              value={task}
              onChange={(e) => setTask(e.target.value)}
              rows={4}
            />
          </div>
        )}

        {isLive && topEntries.length > 0 && (
          <div className="admin-contest-results admin-contest-results--compact">
            <h4 className="admin-contest-section-title">Current Top 10</h4>
            {topEntries.map((entry, index) => (
              <div key={`${entry.walletAddress ?? entry.name}-${index}`} className="admin-contest-result-row">
                <span className="admin-contest-result-rank">#{index + 1}</span>
                <span className="admin-contest-result-wallet">
                  {formatWallet(entry.walletAddress)}
                </span>
                <span className="admin-contest-result-score">
                  {entry.score.toLocaleString()}
                </span>
              </div>
            ))}
          </div>
        )}

        <div className="admin-modal-actions">
          <button type="button" className="toggle-btn" onClick={onClose} disabled={saving}>
            Cancel
          </button>
          {isLive ? (
            <button
              type="button"
              className="add-submit-btn admin-modal-save"
              onClick={handleSaveEdit}
              disabled={saving}
            >
              {saving ? "Saving..." : "Save Changes"}
            </button>
          ) : (
            <button
              type="button"
              className="add-submit-btn admin-modal-save"
              onClick={handleStartContest}
              disabled={saving}
            >
              {saving ? "Starting..." : isEnded ? "Start New Contest" : "Start Contest"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
