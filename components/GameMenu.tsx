"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import {
  gameMenuBackgroundCandidates,
  gameMenuImageCandidates,
  getGameTutorialCandidates,
  getGameTutorialSeenKey,
} from "@/lib/game-assets";
import { Game, gameHasContestLive, gameHasLeaderboard } from "@/types";

interface GameMenuProps {
  game: Game;
  /** Pre-decoded fallback/hero image — preferred over candidate cascade. */
  primaryImageSrc?: string | null;
  /** Pre-decoded tutorial image — preferred over candidate cascade. */
  tutorialImageSrc?: string | null;
  onStart: () => void | Promise<void>;
  onLeaderboard: () => void;
  starting?: boolean;
  sparkError?: string;
}

export default function GameMenu({
  game,
  primaryImageSrc = null,
  tutorialImageSrc = null,
  onStart,
  onLeaderboard,
  starting = false,
  sparkError,
}: GameMenuProps) {
  const router = useRouter();
  const contestLive = gameHasContestLive(game);

  const bgCandidates = useMemo(() => {
    const list = gameMenuBackgroundCandidates(game);
    if (primaryImageSrc) {
      return [primaryImageSrc, ...list.filter((u) => u !== primaryImageSrc)];
    }
    return list;
  }, [game, primaryImageSrc]);

  const logoCandidates = useMemo(() => {
    const list = gameMenuImageCandidates(game);
    if (primaryImageSrc) {
      return [primaryImageSrc, ...list.filter((u) => u !== primaryImageSrc)];
    }
    return list;
  }, [game, primaryImageSrc]);

  const tutorialCandidates = useMemo(() => {
    const list = getGameTutorialCandidates(game);
    if (tutorialImageSrc) {
      return [tutorialImageSrc, ...list.filter((u) => u !== tutorialImageSrc)];
    }
    return list;
  }, [game, tutorialImageSrc]);

  const tutorialSeenKey = useMemo(() => getGameTutorialSeenKey(game), [game]);
  const contestPosterSrc = "/contest-tutorial.webp";

  const [bgIdx, setBgIdx] = useState(0);
  const [logoIdx, setLogoIdx] = useState(0);
  const [tutorialIdx, setTutorialIdx] = useState(0);
  const [tutorialOpen, setTutorialOpen] = useState(false);
  const [contestPosterDismissed, setContestPosterDismissed] = useState(false);

  const bgSrc = bgCandidates[bgIdx];
  const menuImageSrc = logoCandidates[logoIdx];
  const tutorialSrc = tutorialCandidates[tutorialIdx];
  const contestPosterOpen =
    contestLive && !contestPosterDismissed && !tutorialOpen;

  const dismissTutorial = useCallback(() => {
    if (typeof window !== "undefined") {
      window.localStorage.setItem(tutorialSeenKey, "1");
    }
    setTutorialOpen(false);
  }, [tutorialSeenKey]);

  const dismissContestPoster = useCallback(() => {
    setContestPosterDismissed(true);
  }, []);

  useEffect(() => {
    setBgIdx(0);
    setLogoIdx(0);
    setTutorialIdx(0);
    setContestPosterDismissed(false);
  }, [game.id, primaryImageSrc]);

  useEffect(() => {
    if (!tutorialSrc || typeof window === "undefined") {
      setTutorialOpen(false);
      return;
    }

    const seen = window.localStorage.getItem(tutorialSeenKey) === "1";
    setTutorialOpen(!seen);
  }, [tutorialSrc, tutorialSeenKey]);

  useEffect(() => {
    if (!tutorialOpen && !contestPosterOpen) return;

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      if (tutorialOpen) {
        dismissTutorial();
        return;
      }
      if (contestPosterOpen) dismissContestPoster();
    }

    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.body.style.overflow = prevOverflow;
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [
    tutorialOpen,
    contestPosterOpen,
    dismissTutorial,
    dismissContestPoster,
  ]);

  const tutorialModal =
    tutorialOpen && tutorialSrc ? (
      <div className="game-tutorial-backdrop" role="presentation">
        <div
          className="game-tutorial"
          role="dialog"
          aria-modal="true"
          aria-label={`${game.name} tutorial`}
        >
          <div className="game-tutorial-media">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={tutorialSrc}
              alt={`${game.name} how to play`}
              className="game-tutorial-img"
              loading="eager"
              fetchPriority="high"
              decoding="async"
              onError={() => setTutorialIdx((i) => i + 1)}
            />
          </div>
          <button
            type="button"
            className="game-tutorial-btn"
            onClick={dismissTutorial}
          >
            Let&apos;s Go
          </button>
        </div>
      </div>
    ) : null;

  const contestPosterModal = contestPosterOpen ? (
    <div className="game-tutorial-backdrop" role="presentation">
      <div
        className="game-tutorial"
        role="dialog"
        aria-modal="true"
        aria-label="Contest is live"
      >
        <div className="game-tutorial-media game-tutorial-media--contest">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={contestPosterSrc}
            alt="Contest details"
            className="game-tutorial-img"
            loading="eager"
            fetchPriority="high"
            decoding="async"
          />
        </div>
        <button
          type="button"
          className="game-tutorial-btn"
          onClick={dismissContestPoster}
        >
          Let&apos;s Go
        </button>
      </div>
    </div>
  ) : null;

  return (
    <div className="game-menu">
      <div className="game-menu-bg">
        {bgSrc ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={bgSrc}
            alt=""
            className="game-menu-bg-img"
            loading="eager"
            fetchPriority="high"
            decoding="async"
            onError={() => setBgIdx((i) => i + 1)}
          />
        ) : (
          <div className="game-menu-bg-fallback" />
        )}
        <div className="game-menu-bg-overlay" />
      </div>

      <div className="game-menu-grid" aria-hidden />

      <div className="game-menu-topbar">
        <button
          type="button"
          className="game-menu-back"
          onClick={() => router.push("/")}
          aria-label="Back to home"
        >
          <svg
            className="game-menu-back__icon"
            viewBox="0 0 24 24"
            fill="none"
            aria-hidden="true"
          >
            <path
              d="M14.5 5.5 8 12l6.5 6.5"
              stroke="currentColor"
              strokeWidth="2.6"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </button>
        {tutorialSrc ? (
          <button
            type="button"
            className="game-menu-info"
            onClick={() => setTutorialOpen(true)}
            aria-label="How to play"
          >
            <span className="game-menu-info__glyph" aria-hidden>
              i
            </span>
          </button>
        ) : (
          <span className="game-menu-topbar__spacer" aria-hidden />
        )}
      </div>

      <div className="game-menu-stack">
        {contestLive && (
          <div className="game-menu-contest-stripe" aria-label="Contest is live">
            <div className="game-menu-contest-stripe-track">
              {Array.from({ length: 8 }, (_, i) => (
                <span key={i} aria-hidden={i > 0}>
                  Contest is Live
                </span>
              ))}
            </div>
          </div>
        )}

        <div className="game-menu-card">
          <div className="game-menu-logo-wrap">
            {menuImageSrc ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={menuImageSrc}
                alt={game.name}
                className="game-menu-logo"
                loading="eager"
                fetchPriority="high"
                decoding="async"
                onError={() => setLogoIdx((i) => i + 1)}
              />
            ) : (
              <span className="game-menu-logo-fallback" aria-hidden />
            )}
          </div>
        </div>

        <div className="game-menu-actions">
          <button
            type="button"
            className="game-menu-btn game-menu-btn--start"
            onClick={onStart}
            disabled={starting}
          >
            <span className="game-menu-btn__icon" aria-hidden>
              ▶
            </span>
            {starting ? "Waiting for Approval…" : "Start Game"}
          </button>
          {sparkError && (
            <p className="game-menu-spark-error" role="alert">
              {sparkError}
            </p>
          )}
          {gameHasLeaderboard(game) && (
            <button
              type="button"
              className="game-menu-btn game-menu-btn--leaderboard"
              onClick={onLeaderboard}
            >
              <span className="game-menu-btn__icon" aria-hidden>
                🏆
              </span>
              Leaderboard
            </button>
          )}
        </div>
      </div>

      {typeof document !== "undefined"
        ? (tutorialModal || contestPosterModal) &&
          createPortal(tutorialModal || contestPosterModal, document.body)
        : tutorialModal || contestPosterModal}
    </div>
  );
}
