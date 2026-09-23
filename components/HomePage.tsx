"use client";

import { useEffect, useMemo, useState } from "react";
import AppDrawer, { AppView } from "@/components/AppDrawer";
import AchievementsView from "@/components/AchievementsView";
import ActivityLeaderboardPanel from "@/components/ActivityLeaderboardButton";
import GameCard from "@/components/GameCard";
import HomeFeed, { GameCatalog } from "@/components/HomeFeed";
import Logo from "@/components/Logo";
import SparkBatteryBar from "@/components/SparkBatteryBar";
import { usePlayerProfile } from "@/components/PlayerProfileProvider";
import { pingActivityVisit } from "@/lib/activity-client";
import { formatContestCountdown } from "@/lib/contest";
import { sortGames } from "@/lib/game-sort";
import {
  readCachedGamesList,
  shouldBackgroundRefreshGamesList,
  writeCachedGamesList,
} from "@/lib/games-list-client-cache";
import { fetchHomeShell } from "@/lib/home-client";
import { getCachedWallet } from "@/lib/player-id";
import { Game, gameHasContestLive, gameIsLive } from "@/types";

const VIEW_TITLE: Record<Exclude<AppView, "home">, string> = {
  games: "Games",
  contests: "Contests",
  leaderboard: "Global Leaderboard",
  achievements: "Achievements",
};

export default function HomePage() {
  const { walletAddress } = usePlayerProfile();
  const [games, setGames] = useState<Game[]>(() => {
    return readCachedGamesList()?.games ?? [];
  });
  const [playCounts, setPlayCounts] = useState<Record<string, number>>(() => {
    return readCachedGamesList()?.playCounts ?? {};
  });
  const [loading, setLoading] = useState(() => !readCachedGamesList());
  const [error, setError] = useState("");
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [view, setView] = useState<AppView>("home");
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    let cancelled = false;
    const hadCache = Boolean(readCachedGamesList());

    async function loadGames(background = false) {
      if (!background) {
        setLoading(true);
        setError("");
      }

      try {
        const data = await fetchHomeShell(getCachedWallet() ?? undefined);
        if (cancelled) return;

        const nextGames = data.games ?? [];
        const nextPlayCounts = data.playCounts ?? {};
        setGames(nextGames);
        setPlayCounts(nextPlayCounts);
        writeCachedGamesList({
          games: nextGames,
          playCounts: nextPlayCounts,
          fetchedAt: Date.now(),
        });
      } catch (err) {
        if (cancelled) return;
        if (!background || !hadCache) {
          setError(
            err instanceof Error
              ? err.message
              : "Could not load games. Please try again."
          );
        }
      } finally {
        if (!cancelled && !background) setLoading(false);
      }
    }

    if (hadCache) {
      void loadGames(true);
    } else {
      void loadGames(false);
    }

    const onVisible = () => {
      if (
        document.visibilityState === "visible" &&
        shouldBackgroundRefreshGamesList()
      ) {
        void loadGames(true);
      }
    };

    document.addEventListener("visibilitychange", onVisible);
    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);

  useEffect(() => {
    if (!walletAddress) return;
    void pingActivityVisit(walletAddress);
  }, [walletAddress]);

  useEffect(() => {
    if (view !== "contests") return;
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [view]);

  const ordered = useMemo(() => sortGames(games), [games]);
  const live = ordered.filter((game) => gameIsLive(game));
  const contests = live.filter((game) => gameHasContestLive(game));

  return (
    <div className="home">
      <div className="home-ambient" aria-hidden />
      <div className="home-shell">
        <header className="topbar">
          <div className="topbar-brand">
            <button
              type="button"
              className="menu-btn"
              aria-label="Open menu"
              onClick={() => setDrawerOpen(true)}
            >
              <span />
              <span />
              <span />
            </button>
            <Logo variant="header" />
          </div>
          <SparkBatteryBar />
        </header>

        <main className="home-main">
          {error ? (
            <p className="no-games">{error}</p>
          ) : loading ? (
            <div
              className="games-grid games-grid--loading"
              aria-busy="true"
              aria-label="Loading games"
            >
              {Array.from({ length: 4 }, (_, i) => (
                <div key={i} className="game-card-skeleton" aria-hidden />
              ))}
            </div>
          ) : view === "home" ? (
            <HomeFeed games={games} playCounts={playCounts} />
          ) : (
            <div className="home-view">
              {view !== "achievements" && view !== "leaderboard" && (
                <h2 className="home-section__title">{VIEW_TITLE[view]}</h2>
              )}
              {view === "games" && (
                <GameCatalog
                  games={live}
                  playCounts={playCounts}
                  empty="No live games yet."
                />
              )}
              {view === "contests" &&
                (contests.length === 0 ? (
                  <p className="no-games">No live contests right now.</p>
                ) : (
                  <div className="games-grid">
                    {contests.map((game) => (
                      <GameCard
                        key={game.id}
                        game={game}
                        variant="square"
                        countdownLabel={
                          game.contestEndsAt
                            ? formatContestCountdown(game.contestEndsAt - now)
                            : undefined
                        }
                      />
                    ))}
                  </div>
                ))}
              {view === "leaderboard" && <ActivityLeaderboardPanel />}
              {view === "achievements" && <AchievementsView />}
            </div>
          )}
        </main>
      </div>

      <AppDrawer
        open={drawerOpen}
        view={view}
        onClose={() => setDrawerOpen(false)}
        onNavigate={setView}
        onOpenSparks={() => {
          window.dispatchEvent(new Event("arcadex-open-sparks"));
        }}
      />
    </div>
  );
}
