"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import {
  gameAssetCandidates,
  gameFallbackCandidates,
  preloadGameMenuAssets,
} from "@/lib/game-assets";
import { formatPlayCount } from "@/lib/format-play-count";
import { Game, gameHasContestLive, gameIsLive } from "@/types";

interface GameCardProps {
  game: Game;
  playCount?: number;
  /** Eager-load above-the-fold thumbs; lazy-load the rest. */
  priority?: boolean;
}

export default function GameCard({
  game,
  playCount = 0,
  priority = false,
}: GameCardProps) {
  const isLive = gameIsLive(game);
  const contestLive = gameHasContestLive(game);

  const thumbCandidates = useMemo(
    () => gameAssetCandidates(game, "thumbnail"),
    [game]
  );
  const logoCandidates = useMemo(
    () => gameAssetCandidates(game, "logo"),
    [game]
  );
  const fallbackCandidates = useMemo(
    () => gameFallbackCandidates(game),
    [game]
  );

  const [thumbIdx, setThumbIdx] = useState(0);
  const [logoIdx, setLogoIdx] = useState(0);
  const [fallbackIdx, setFallbackIdx] = useState(0);

  const thumbSrc = thumbCandidates[thumbIdx];
  const logoSrc = logoCandidates[logoIdx];
  const fallbackSrc = fallbackCandidates[fallbackIdx];

  const imgLoading = priority ? "eager" : "lazy";
  const imgPriority = priority ? ("high" as const) : ("auto" as const);

  const warmMenu = () => {
    if (isLive) preloadGameMenuAssets(game, { includeTutorial: true });
  };

  const thumbContent = thumbSrc ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={thumbSrc}
      alt={game.name}
      className="thumb-img"
      loading={imgLoading}
      fetchPriority={imgPriority}
      decoding="async"
      onError={() => setThumbIdx((i) => i + 1)}
    />
  ) : logoSrc ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={logoSrc}
      alt={game.name}
      className="thumb-img"
      loading={imgLoading}
      fetchPriority={imgPriority}
      decoding="async"
      onError={() => setLogoIdx((i) => i + 1)}
    />
  ) : fallbackSrc ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={fallbackSrc}
      alt={game.name}
      className="thumb-img"
      loading={imgLoading}
      fetchPriority={imgPriority}
      decoding="async"
      onError={() => setFallbackIdx((i) => i + 1)}
    />
  ) : (
    <div className="thumb-placeholder" aria-hidden />
  );

  const cardBody = (
    <>
      <div className="thumb-wrap">
        {thumbContent}
        {contestLive && (
          <span className="game-card-contest-badge" aria-label="Contest live">
            CONTEST LIVE
          </span>
        )}
        {!isLive && (
          <div className="coming-soon-overlay" aria-hidden>
            <span>Coming Soon</span>
          </div>
        )}
      </div>

      <div className="card-info">
        <p className="card-title">{game.name}</p>
        <p className="card-plays">
          {formatPlayCount(playCount)}{" "}
          {playCount === 1 ? "play" : "plays"}
        </p>
      </div>
    </>
  );

  const cardClass = [
    "game-card",
    !isLive && "game-card--coming-soon",
    contestLive && "game-card--contest-live",
  ]
    .filter(Boolean)
    .join(" ");

  if (!isLive) {
    return (
      <div className={cardClass} aria-label={`${game.name} — coming soon`}>
        {cardBody}
      </div>
    );
  }

  return (
    <Link
      href={`/game/${game.id}`}
      className={cardClass}
      prefetch={false}
      onPointerEnter={warmMenu}
      onTouchStart={warmMenu}
    >
      {cardBody}
    </Link>
  );
}
