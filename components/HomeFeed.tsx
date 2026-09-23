"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import GameCard from "@/components/GameCard";
import { formatContestCountdown } from "@/lib/contest";
import { readRecentPlayIds } from "@/lib/recent-plays";
import { sortGames } from "@/lib/game-sort";
import { Game, gameHasContestLive, gameIsLive } from "@/types";

interface HomeFeedProps {
  games: Game[];
  playCounts: Record<string, number>;
}

function Rail({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <section className="home-section">
      <h2 className="home-section__title">{title}</h2>
      <div className="home-rail">{children}</div>
    </section>
  );
}

export default function HomeFeed({ games, playCounts }: HomeFeedProps) {
  const [now, setNow] = useState(() => Date.now());
  const [recentIds, setRecentIds] = useState<string[]>([]);

  useEffect(() => {
    setRecentIds(readRecentPlayIds());
  }, []);

  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);

  const ordered = useMemo(() => sortGames(games), [games]);
  const live = ordered.filter((game) => gameIsLive(game));
  const contests = live.filter((game) => gameHasContestLive(game));
  const comingSoon = ordered.filter((game) => !gameIsLive(game));
  const byId = new Map(live.map((game) => [game.id, game]));
  const continuePlaying = recentIds
    .map((id) => byId.get(id))
    .filter((game): game is Game => Boolean(game));

  return (
    <div className="home-feed">
      {contests.length > 0 && (
        <Rail title="Live contests">
          {contests.map((game) => (
            <GameCard
              key={game.id}
              game={game}
              variant="square"
              priority
              countdownLabel={
                game.contestEndsAt
                  ? formatContestCountdown(game.contestEndsAt - now)
                  : undefined
              }
            />
          ))}
        </Rail>
      )}

      {continuePlaying.length > 0 && (
        <Rail title="Continue playing">
          {continuePlaying.map((game) => (
            <GameCard key={game.id} game={game} variant="square" />
          ))}
        </Rail>
      )}

      <section className="home-section">
        <h2 className="home-section__title">All games</h2>
        <div className="games-grid">
          {live.map((game, index) => (
            <GameCard
              key={game.id}
              game={game}
              variant="catalog"
              playCount={playCounts[game.id] ?? 0}
              priority={index < 4}
            />
          ))}
        </div>
        {live.length === 0 && (
          <p className="no-games">No games yet. Check back soon!</p>
        )}
      </section>

      {comingSoon.length > 0 && (
        <Rail title="Coming soon">
          {comingSoon.map((game) => (
            <GameCard key={game.id} game={game} variant="square" />
          ))}
        </Rail>
      )}
    </div>
  );
}

export function GameCatalog({
  games,
  playCounts,
  empty,
}: {
  games: Game[];
  playCounts: Record<string, number>;
  empty: string;
}) {
  if (games.length === 0) return <p className="no-games">{empty}</p>;
  return (
    <div className="games-grid">
      {games.map((game) => (
        <GameCard
          key={game.id}
          game={game}
          variant="catalog"
          playCount={playCounts[game.id] ?? 0}
        />
      ))}
    </div>
  );
}
