"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { Game, gameHasLeaderboard, gameHasContestLive, gameIsLive } from "@/types";
import GameClient from "@/components/GameClient";
import GameMenu from "@/components/GameMenu";
import Leaderboard, { type LeaderboardMode } from "@/components/Leaderboard";
import LoadingScreen from "@/components/LoadingScreen";
import NoSparksModal from "@/components/NoSparksModal";
import { usePlayerProfile } from "@/components/PlayerProfileProvider";
import { useSparks } from "@/components/SparkProvider";
import {
  getGameTutorialSeenKey,
  loadGameTutorialImage,
  loadPrimaryGameMenuImage,
  preloadGameMenuAssets,
} from "@/lib/game-assets";
import { formatChainError } from "@/lib/celo-public-client";
import {
  isArcadeXTxHubConfigured,
  playPurpose,
  signInOnChain,
} from "@/lib/arcadex-tx-hub";

export default function GamePageClient() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { walletAddress } = usePlayerProfile();
  const { sparks, spendForGame } = useSparks();
  const [game, setGame] = useState<Game | null>(null);
  const [menuImageSrc, setMenuImageSrc] = useState<string | null>(null);
  const [tutorialImageSrc, setTutorialImageSrc] = useState<string | null>(null);
  const [menuReady, setMenuReady] = useState(false);
  const [started, setStarted] = useState(false);
  const [lbOpen, setLbOpen] = useState(false);
  const [lbMode, setLbMode] = useState<LeaderboardMode>("default");
  const [loading, setLoading] = useState(true);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState("");
  const [sparkError, setSparkError] = useState("");
  const [noSparksOpen, setNoSparksOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function loadGame() {
      setLoading(true);
      setMenuReady(false);
      setMenuImageSrc(null);
      setTutorialImageSrc(null);
      setError("");

      try {
        const res = await fetch(`/api/games/${id}`, { cache: "no-store" });
        const data = (await res.json()) as { game?: Game; error?: string };

        if (!res.ok) {
          throw new Error(data.error ?? "Game not found.");
        }

        const nextGame = data.game ?? null;
        if (cancelled) return;

        setGame(nextGame);

        if (nextGame && gameIsLive(nextGame)) {
          fetch(`/api/games/${id}/play`, { method: "POST" }).catch(() => {
            // Play tracking is best-effort
          });

          const tutorialUnseen =
            typeof window !== "undefined" &&
            window.localStorage.getItem(getGameTutorialSeenKey(nextGame)) !==
              "1";

          const primaryPromise = loadPrimaryGameMenuImage(nextGame);
          const tutorialPromise = loadGameTutorialImage(nextGame);

          if (tutorialUnseen) {
            const [primary, tutorial] = await Promise.all([
              primaryPromise,
              tutorialPromise,
            ]);
            if (cancelled) return;
            setMenuImageSrc(primary);
            setTutorialImageSrc(tutorial);
          } else {
            const primary = await primaryPromise;
            if (cancelled) return;
            setMenuImageSrc(primary);
            void tutorialPromise.then((tutorial) => {
              if (!cancelled) setTutorialImageSrc(tutorial);
            });
          }

          preloadGameMenuAssets(nextGame, { includeTutorial: true });
          setMenuReady(true);
        } else if (!cancelled) {
          setMenuReady(true);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Game not found.");
          setGame(null);
          setMenuReady(true);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    loadGame();
    return () => {
      cancelled = true;
    };
  }, [id]);

  const handleStart = useCallback(async () => {
    setSparkError("");

    if (!walletAddress) {
      setSparkError("Connect your wallet in MiniPay to play.");
      return;
    }

    if (!sparks.hasInfinite && sparks.available === 0) {
      setNoSparksOpen(true);
      return;
    }

    setStarting(true);
    try {
      if (isArcadeXTxHubConfigured() && game?.id) {
        await signInOnChain(playPurpose(game.id));
      }
      await spendForGame();
      setStarted(true);
    } catch (err) {
      setSparkError(
        formatChainError(err) ||
          (err instanceof Error ? err.message : "Could not start game.")
      );
    } finally {
      setStarting(false);
    }
  }, [
    walletAddress,
    sparks.hasInfinite,
    sparks.available,
    spendForGame,
    game?.id,
  ]);

  if (loading || (game && gameIsLive(game) && !menuReady && !started)) {
    return <LoadingScreen message="Loading game" />;
  }

  if (!game) {
    return (
      <div className="loading-screen">
        <p className="loading-screen__text">{error || "Game not found."}</p>
      </div>
    );
  }

  if (!gameIsLive(game)) {
    return (
      <div className="coming-soon-screen">
        <p className="coming-soon-screen__title">Coming Soon</p>
        <p className="coming-soon-screen__subtitle">
          {game.name} is not available yet.
        </p>
        <button
          type="button"
          className="game-menu-btn game-menu-btn--back"
          onClick={() => router.push("/")}
        >
          Back
        </button>
      </div>
    );
  }

  function handleGetSpark() {
    setNoSparksOpen(false);
    sessionStorage.setItem("openSparkPanel", "1");
    router.push("/");
  }

  function openLeaderboard(mode: LeaderboardMode) {
    setLbMode(mode);
    setLbOpen(true);
  }

  function closeLeaderboard() {
    setLbOpen(false);
    setLbMode("default");
  }

  return (
    <>
      {!started ? (
        <GameMenu
          game={game}
          primaryImageSrc={menuImageSrc}
          tutorialImageSrc={tutorialImageSrc}
          onStart={handleStart}
          onLeaderboard={() => openLeaderboard("default")}
          starting={starting}
          sparkError={sparkError}
        />
      ) : (
        <GameClient
          game={game}
          onScoreSubmitted={() => openLeaderboard("postSubmit")}
          onBackToMenu={() => {
            closeLeaderboard();
            setStarted(false);
          }}
        />
      )}
      {gameHasLeaderboard(game) && (
        <Leaderboard
          gameId={game.id}
          gameName={game.name}
          contestLive={gameHasContestLive(game)}
          open={lbOpen}
          mode={lbMode}
          onClose={closeLeaderboard}
        />
      )}
      <NoSparksModal
        open={noSparksOpen}
        onClose={() => setNoSparksOpen(false)}
        onGetSpark={handleGetSpark}
      />
    </>
  );
}
