"use client";

import { useEffect, useRef, useCallback, useState, useMemo } from "react";
import LoadingScreen from "@/components/LoadingScreen";
import LeaderboardSubmitToast, {
  type LeaderboardSubmitToastState,
} from "@/components/LeaderboardSubmitToast";
import {
  normalizeUnityMessageType,
  notifyUnityLeaderboardSubmit,
  replayLeaderboardSubmitToUnity,
  sendToUnity,
  UnityMessage,
  type LeaderboardSubmitUnityResult,
} from "@/lib/bridge";
import { getGameProgress, saveGameProgress } from "@/lib/game-progress-client";
import { getGameState, saveGameState } from "@/lib/game-state-client";
import {
  getLeaderboard,
  submitScoreToLeaderboard,
} from "@/lib/leaderboard-client";
import { buildGameIframeUrl, getShellOrigin } from "@/lib/game-iframe-url";
import { extractProgressExtras, extractModeLevels, lineLinkFieldsFromModes, readProgressNumber } from "@/lib/progress-value";
import { getWalletSessionToken } from "@/lib/wallet-session-client";
import { usePlayerProfile } from "@/components/PlayerProfileProvider";
import { resolveWalletOnAppOpen } from "@/lib/walletAuth";
import { formatChainError } from "@/lib/celo-public-client";
import { purchaseScoreSubmitOnChain } from "@/lib/score-submit-purchase";
import {
  clearPendingLeaderboardSubmit,
  getLeaderboardSubmitResult,
  setPendingLeaderboardSubmit,
} from "@/lib/leaderboard-submit-result";
import { Game, gameHasContestLive, gameHasLeaderboard } from "@/types";

interface GameClientProps {
  game: Game;
  onScoreSubmitted?: () => void;
  onBackToMenu?: () => void;
}

const GAME_LOAD_FALLBACK_MS = 12000;
const PROGRESS_RETRY_DELAYS_MS = [0, 600, 1500, 3000] as const;

export default function GameClient({
  game,
  onScoreSubmitted,
  onBackToMenu,
}: GameClientProps) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const loadFallbackRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [gameReady, setGameReady] = useState(false);
  const [submitToast, setSubmitToast] = useState<LeaderboardSubmitToastState | null>(
    null
  );
  const dismissSubmitToast = useCallback(() => setSubmitToast(null), []);
  /** Score waiting for a user tap — MiniPay needs a real gesture, not postMessage. */
  const [pendingSubmitScore, setPendingSubmitScore] = useState<number | null>(
    null
  );
  const [payingSubmit, setPayingSubmit] = useState(false);
  const personalBestRef = useRef(0);
  const leaderboardEnabled = gameHasLeaderboard(game);
  const contestLive = gameHasContestLive(game);
  const shellOrigin = getShellOrigin();
  const progressRetryRef = useRef<ReturnType<typeof setTimeout>[]>([]);
  const {
    playerName,
    profile,
    walletAddress,
    isReady,
    updateWalletAddress,
  } = usePlayerProfile();

  const resolvedName = playerName || profile?.name || "";
  const resolvedWallet = walletAddress || profile?.walletAddress || "";

  const iframeSrc = useMemo(() => {
    if (!isReady) return null;
    return buildGameIframeUrl(game.url, {
      gameId: game.id,
      shellOrigin,
      walletAddress: resolvedWallet || undefined,
      playerName: resolvedName || undefined,
      hasLeaderboard: leaderboardEnabled,
      sessionToken: getWalletSessionToken() || undefined,
    });
  }, [
    isReady,
    game.url,
    game.id,
    shellOrigin,
    resolvedWallet,
    resolvedName,
    leaderboardEnabled,
  ]);

  const clearProgressRetries = useCallback(() => {
    for (const id of progressRetryRef.current) clearTimeout(id);
    progressRetryRef.current = [];
  }, []);

  const deliverProgressToUnity = useCallback(
    (
      payload: {
        highScore: number;
        level: number;
        hasLeaderboard: boolean;
        modes?: Record<string, number> | null;
        gameState?: Record<string, unknown> | null;
        gameStateRevision?: number;
        gameStateFound?: boolean;
      },
      opts?: {
        wallet?: string;
        playerName?: string;
        includeBootstrap?: boolean;
      }
    ) => {
      const storedValue = payload.hasLeaderboard
        ? payload.highScore
        : payload.level;
      const lineLink = lineLinkFieldsFromModes(payload.modes);
      const progressMessage = {
        success: true,
        highScore: payload.highScore,
        score: payload.highScore,
        level: payload.level,
        value: storedValue,
        modes: payload.modes ?? null,
        ...lineLink,
        hasLeaderboard: payload.hasLeaderboard,
      };

      sendToUnity(iframeRef, "OnProgressReceived", progressMessage);

      if (opts?.includeBootstrap !== false) {
        sendToUnity(iframeRef, "OnBootstrapDataReceived", {
          gameId: game.id,
          shellOrigin,
          walletAddress: opts?.wallet ?? resolvedWallet,
          playerName: opts?.playerName ?? resolvedName,
          contestLive,
          ...payload,
          score: payload.highScore,
          value: storedValue,
          modes: payload.modes ?? null,
          ...lineLink,
          hints: 0,
          tutorialComplete: false,
          gamePurchased: true,
          gameStateIncluded: true,
          gameStateFound: payload.gameStateFound === true,
          gameState: payload.gameState ?? null,
        });
      }
    },
    [
      game.id,
      shellOrigin,
      resolvedWallet,
      resolvedName,
      contestLive,
    ]
  );

  const scheduleProgressRetries = useCallback(
    (
      payload: {
        highScore: number;
        level: number;
        hasLeaderboard: boolean;
        modes?: Record<string, number> | null;
        gameState?: Record<string, unknown> | null;
        gameStateRevision?: number;
        gameStateFound?: boolean;
      },
      opts?: {
        wallet?: string;
        playerName?: string;
      }
    ) => {
      clearProgressRetries();
      progressRetryRef.current = PROGRESS_RETRY_DELAYS_MS.map((delay) =>
        setTimeout(() => {
          deliverProgressToUnity(payload, opts);
        }, delay)
      );
    },
    [clearProgressRetries, deliverProgressToUnity]
  );

  const markGameReady = useCallback(() => {
    if (loadFallbackRef.current) {
      clearTimeout(loadFallbackRef.current);
      loadFallbackRef.current = null;
    }
    setGameReady(true);
  }, []);

  const scheduleLoadFallback = useCallback(() => {
    if (loadFallbackRef.current) clearTimeout(loadFallbackRef.current);
    loadFallbackRef.current = setTimeout(markGameReady, GAME_LOAD_FALLBACK_MS);
  }, [markGameReady]);

  const persistProgress = useCallback(
    async (
      value: number,
      name: string,
      resolvedWalletAddr: string,
      opts?: {
        mode?: string;
        modes?: Record<string, number>;
        extras?: Record<string, unknown>;
      }
    ) => {
      const previousBest = personalBestRef.current;
      const result = await saveGameProgress(game.id, resolvedWalletAddr, value, {
        playerName: name,
        mode: opts?.mode,
        modes: opts?.modes,
        extras: opts?.extras,
      });
      const highScore =
        result.progress.score ?? (leaderboardEnabled ? value : previousBest);
      const level =
        result.progress.level ?? (leaderboardEnabled ? 0 : value);
      if (leaderboardEnabled && highScore > previousBest) {
        personalBestRef.current = highScore;
      }
      return {
        highScore,
        level,
        modes: result.progress.modes ?? result.modes ?? opts?.modes ?? null,
      };
    },
    [game.id, leaderboardEnabled]
  );

  const showSubmitFeedback = useCallback((result: LeaderboardSubmitUnityResult) => {
    if (result.success) {
      setSubmitToast({
        phase: "success",
        message: "Score submitted to the leaderboard!",
      });
      onScoreSubmitted?.();
      return;
    }

    const error = result.error?.trim();
    if (
      !error ||
      error.toLowerCase().includes("user rejected") ||
      error.toLowerCase().includes("denied")
    ) {
      setSubmitToast({
        phase: "error",
        message: "Payment cancelled.",
      });
      return;
    }

    setSubmitToast({
      phase: "error",
      message: formatChainError(new Error(error)),
    });
  }, [onScoreSubmitted]);

  const deliverLeaderboardSubmitResult = useCallback(
    (result: LeaderboardSubmitUnityResult) => {
      notifyUnityLeaderboardSubmit(iframeRef, result, { gameId: game.id });
      showSubmitFeedback(result);
    },
    [game.id, showSubmitFeedback]
  );

  const cancelPendingSubmit = useCallback(() => {
    if (payingSubmit) return;
    const score = pendingSubmitScore;
    setPendingSubmitScore(null);
    setSubmitToast(null);
    if (score != null) {
      clearPendingLeaderboardSubmit(game.id);
      deliverLeaderboardSubmitResult({
        success: false,
        highScore: personalBestRef.current,
        error: "Payment cancelled.",
      });
    }
  }, [payingSubmit, pendingSubmitScore, game.id, deliverLeaderboardSubmitResult]);

  const confirmPendingSubmit = useCallback(async () => {
    if (pendingSubmitScore == null || payingSubmit) return;

    const score = pendingSubmitScore;
    const wallet = walletAddress || profile?.walletAddress || "";
    if (!wallet) {
      setPendingSubmitScore(null);
      deliverLeaderboardSubmitResult({
        success: false,
        highScore: personalBestRef.current,
        error: "No wallet address available.",
      });
      return;
    }

    // Release Unity pointer lock so MiniPay can show the wallet sheet.
    try {
      document.exitPointerLock?.();
    } catch {
      /* ignore */
    }

    setPayingSubmit(true);
    setPendingSubmitScore(null);
    setSubmitToast({
      phase: "submitting",
      message: "Submitting score… Confirm the payment in MiniPay.",
    });
    setPendingLeaderboardSubmit(game.id, score);

    try {
      const { txHash } = await purchaseScoreSubmitOnChain();
      const result = await submitScoreToLeaderboard(game.id, {
        walletAddress: wallet,
        txHash,
        score,
      });
      clearPendingLeaderboardSubmit(game.id);
      deliverLeaderboardSubmitResult({
        success: true,
        highScore: result.highScore,
        leaderboardScore: result.leaderboardScore,
      });
    } catch (err) {
      clearPendingLeaderboardSubmit(game.id);
      deliverLeaderboardSubmitResult({
        success: false,
        highScore: personalBestRef.current,
        error: formatChainError(err),
      });
    } finally {
      setPayingSubmit(false);
    }
  }, [
    pendingSubmitScore,
    payingSubmit,
    walletAddress,
    profile?.walletAddress,
    game.id,
    deliverLeaderboardSubmitResult,
  ]);

  const replayStoredSubmitResult = useCallback(() => {
    const stored = getLeaderboardSubmitResult(game.id);
    if (!stored) return;
    replayLeaderboardSubmitToUnity(iframeRef, game.id, stored);
  }, [game.id]);

  useEffect(() => {
    setGameReady(false);
    return () => {
      if (loadFallbackRef.current) clearTimeout(loadFallbackRef.current);
      clearProgressRetries();
    };
  }, [game.url, clearProgressRetries]);

  useEffect(() => {
    if (!gameReady) return;
    replayStoredSubmitResult();
  }, [gameReady, replayStoredSubmitResult]);

  useEffect(() => {
    if (!gameReady || !resolvedWallet) return;

    let cancelled = false;

    async function resyncPersonalBest() {
      try {
        const { progress, hasLeaderboard } = await getGameProgress(
          game.id,
          resolvedWallet,
          { playerName: resolvedName || undefined }
        );
        if (cancelled) return;

        const highScore = progress.score ?? 0;
        const level = progress.level ?? 0;
        personalBestRef.current = Math.max(personalBestRef.current, highScore);
        if (personalBestRef.current <= 0 && level <= 0 && !progress.modes) return;

        deliverProgressToUnity(
          {
            highScore: personalBestRef.current,
            level,
            hasLeaderboard,
            modes: progress.modes ?? null,
          },
          {
            wallet: resolvedWallet,
            playerName: resolvedName,
          }
        );
      } catch {
        // Best-effort resync for Unity home screen
      }
    }

    void resyncPersonalBest();
    return () => {
      cancelled = true;
    };
  }, [
    gameReady,
    game.id,
    resolvedWallet,
    resolvedName,
    deliverProgressToUnity,
  ]);

  const handleMessage = useCallback(
    async (event: MessageEvent) => {
      const msg = event.data as UnityMessage;
      const bridgeType = normalizeUnityMessageType(msg.type);
      if (!bridgeType) {
        if (msg?.type?.startsWith("MINIPAY_")) {
          console.warn("[ArcadeX bridge] unhandled legacy message:", msg.type);
        }
        return;
      }

      switch (bridgeType) {
        case "GAME_BOOTSTRAP": {
          markGameReady();
          const wallet =
            walletAddress ||
            profile?.walletAddress ||
            (await resolveWalletOnAppOpen()) ||
            "";

          if (wallet) {
            sendToUnity(iframeRef, "OnWalletAddressResolved", wallet);
          }

          const bootstrapName = playerName || profile?.name || "";
          let highScore = 0;
          let level = 0;
          let modes: Record<string, number> | null = null;
          let gameState: Record<string, unknown> | null = null;
          let gameStateRevision = 0;
          let gameStateFound = false;
          if (wallet) {
            try {
              const [{ progress, hasLeaderboard }, stateResult] =
                await Promise.all([
                  getGameProgress(game.id, wallet, {
                    playerName: bootstrapName || undefined,
                    force: true,
                  }),
                  getGameState(game.id, wallet).catch(() => null),
                ]);
              highScore = progress.score ?? 0;
              level = progress.level ?? 0;
              modes = progress.modes ?? null;
              personalBestRef.current = highScore;
              if (stateResult) {
                gameState = stateResult.state;
                gameStateRevision = stateResult.revision;
                gameStateFound = stateResult.found;
                if (!modes && stateResult.state) {
                  modes =
                    extractModeLevels(
                      stateResult.state as Record<string, unknown>
                    ) ?? null;
                }
              }
            } catch {
              // Progress is optional during bootstrap
            }
          }

          const progressPayload = {
            highScore,
            level,
            hasLeaderboard: leaderboardEnabled,
            modes,
            gameState,
            gameStateRevision,
            gameStateFound,
          };

          deliverProgressToUnity(progressPayload, {
            wallet,
            playerName: bootstrapName,
          });

          scheduleProgressRetries(progressPayload, {
            wallet,
            playerName: bootstrapName,
          });
          replayStoredSubmitResult();
          break;
        }

        case "GAME_LEADERBOARD_GET": {
          if (!leaderboardEnabled) {
            sendToUnity(iframeRef, "OnLeaderboardReceived", []);
            break;
          }
          const { entries } = await getLeaderboard(game.id);
          sendToUnity(iframeRef, "OnLeaderboardReceived", entries);
          break;
        }

        case "GAME_PROGRESS_SAVE": {
          const payload = (msg.payload ?? {}) as Record<string, unknown> & {
            name?: string;
            score?: number;
            value?: number;
            level?: number;
            mode?: string;
            walletAddress?: string;
          };
          const progressValue = readProgressNumber(payload);
          const modes = extractModeLevels(payload);
          const extras = extractProgressExtras(payload);
          const saveCallback =
            msg.type === "MINIPAY_SUBMIT_SCORE"
              ? "OnScoreSubmitted"
              : "OnProgressSaved";

          if (typeof progressValue !== "number" && !modes && !extras) {
            sendToUnity(iframeRef, saveCallback, {
              success: false,
              error: "value, score, level, modes, or state is required.",
            });
            break;
          }
          const resolvedWalletAddr =
            walletAddress || payload.walletAddress || profile?.walletAddress || "";
          if (!resolvedWalletAddr) {
            sendToUnity(iframeRef, saveCallback, {
              success: false,
              error: "No wallet address available.",
            });
            break;
          }
          if (
            payload.walletAddress &&
            payload.walletAddress !== profile?.walletAddress
          ) {
            updateWalletAddress(payload.walletAddress).catch(() => {
              // Wallet sync is best-effort
            });
          }
          try {
            const valueToSave =
              typeof progressValue === "number"
                ? progressValue
                : modes
                  ? Math.max(0, ...Object.values(modes))
                  : 0;
            const saved = await persistProgress(
              valueToSave,
              playerName || payload.name || "",
              resolvedWalletAddr,
              {
                mode:
                  typeof payload.mode === "string" ? payload.mode : undefined,
                modes,
                extras,
              }
            );
            sendToUnity(iframeRef, saveCallback, {
              success: true,
              highScore: saved.highScore,
              score: saved.highScore,
              level: saved.level,
              value: leaderboardEnabled ? saved.highScore : saved.level,
              modes: saved.modes,
              ...lineLinkFieldsFromModes(saved.modes),
            });
          } catch (err) {
            sendToUnity(iframeRef, saveCallback, {
              success: false,
              error:
                err instanceof Error
                  ? err.message
                  : "Could not save progress.",
            });
          }
          break;
        }

        case "GAME_PROGRESS_GET": {
          const wallet =
            walletAddress || profile?.walletAddress || "";
          if (!wallet) {
            sendToUnity(iframeRef, "OnProgressReceived", {
              success: false,
              error: "No wallet address available.",
            });
            break;
          }
          try {
            const { progress, hasLeaderboard } = await getGameProgress(
              game.id,
              wallet,
              { playerName: playerName || profile?.name || undefined }
            );
            const payload = {
              highScore: progress.score ?? 0,
              level: progress.level ?? 0,
              hasLeaderboard,
              modes: progress.modes ?? null,
            };
            personalBestRef.current = payload.highScore;
            deliverProgressToUnity(payload, {
              wallet,
              playerName: playerName || profile?.name || "",
            });
            scheduleProgressRetries(payload, {
              wallet,
              playerName: playerName || profile?.name || "",
            });
          } catch (err) {
            sendToUnity(iframeRef, "OnProgressReceived", {
              success: false,
              error:
                err instanceof Error
                  ? err.message
                  : "Could not load progress.",
            });
          }
          break;
        }

        case "GAME_LEADERBOARD_SUBMIT": {
          const notifyFailure = (error: string) => {
            deliverLeaderboardSubmitResult({
              success: false,
              highScore: personalBestRef.current,
              error,
            });
          };

          if (!leaderboardEnabled) {
            notifyFailure("Leaderboard disabled for this game.");
            break;
          }
          const { score } = (msg.payload ?? {}) as { score?: number };
          const wallet =
            walletAddress || profile?.walletAddress || "";
          if (!wallet) {
            notifyFailure("No wallet address available.");
            break;
          }
          if (typeof score !== "number" || score <= 0) {
            notifyFailure("score is required.");
            break;
          }

          // Don't open MiniPay from postMessage — wait for a user tap on the shell.
          try {
            document.exitPointerLock?.();
          } catch {
            /* ignore */
          }
          setPendingSubmitScore(score);
          setSubmitToast(null);
          break;
        }

        case "GAME_LEADERBOARD_SUBMIT_POLL": {
          const stored = getLeaderboardSubmitResult(game.id);
          if (stored) {
            replayLeaderboardSubmitToUnity(iframeRef, game.id, stored);
          } else {
            notifyUnityLeaderboardSubmit(
              iframeRef,
              {
                success: false,
                highScore: personalBestRef.current,
                error: "No submit result available yet.",
              },
              { persist: false }
            );
          }
          break;
        }

        case "GAME_STATE_GET": {
          const payload = (msg.payload ?? {}) as { walletAddress?: string };
          const requestId = msg.requestId ?? "";
          const wallet =
            walletAddress || payload.walletAddress || profile?.walletAddress || "";
          if (!wallet) {
            sendToUnity(iframeRef, "OnGameStateReceived", {
              success: false,
              found: false,
              requestId,
              error: "No wallet address available.",
            });
            break;
          }
          try {
            const record = await getGameState(game.id, wallet);
            sendToUnity(iframeRef, "OnGameStateReceived", {
              success: true,
              found: record.found,
              requestId,
              revision: record.revision,
              state: record.state,
            });
          } catch (err) {
            sendToUnity(iframeRef, "OnGameStateReceived", {
              success: false,
              found: false,
              requestId,
              error:
                err instanceof Error
                  ? err.message
                  : "Could not load game state.",
            });
          }
          break;
        }

        case "GAME_STATE_SAVE": {
          const payload = (msg.payload ?? {}) as {
            walletAddress?: string;
            baseRevision?: number;
            requestId?: string;
            state?: Record<string, unknown>;
          };
          const requestId = payload.requestId ?? msg.requestId ?? "";
          const wallet =
            walletAddress || payload.walletAddress || profile?.walletAddress || "";
          if (!wallet) {
            sendToUnity(iframeRef, "OnGameStateSaved", {
              success: false,
              conflict: false,
              requestId,
              error: "No wallet address available.",
            });
            break;
          }
          if (
            !payload.state ||
            typeof payload.state !== "object" ||
            Array.isArray(payload.state)
          ) {
            sendToUnity(iframeRef, "OnGameStateSaved", {
              success: false,
              conflict: false,
              requestId,
              error: "state object is required.",
            });
            break;
          }
          try {
            const record = await saveGameState(game.id, wallet, payload.state, {
              baseRevision: payload.baseRevision,
              requestId,
            });
            sendToUnity(iframeRef, "OnGameStateSaved", {
              success: record.success,
              conflict: record.conflict === true,
              revision: record.revision,
              requestId,
              state: record.state,
              error: record.conflict ? "Game state revision conflict." : "",
            });
          } catch (err) {
            sendToUnity(iframeRef, "OnGameStateSaved", {
              success: false,
              conflict: false,
              requestId,
              error:
                err instanceof Error
                  ? err.message
                  : "Could not save game state.",
            });
          }
          break;
        }

        default:
          console.warn("[ArcadeX bridge] unhandled message:", bridgeType);
      }
    },
    [
      game.id,
      leaderboardEnabled,
      contestLive,
      playerName,
      profile?.name,
      profile?.walletAddress,
      walletAddress,
      shellOrigin,
      updateWalletAddress,
      markGameReady,
      scheduleProgressRetries,
      deliverProgressToUnity,
      persistProgress,
      deliverLeaderboardSubmitResult,
      replayStoredSubmitResult,
    ]
  );

  useEffect(() => {
    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, [handleMessage]);

  return (
    <div className="game-page">
      {!gameReady && (
        <div className="game-loading-overlay" aria-hidden={false}>
          <LoadingScreen message="Loading game" />
        </div>
      )}

      <button
        type="button"
        className="game-close-btn"
        aria-label="Back to menu"
        onClick={() => onBackToMenu?.()}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/home-button.png" alt="" className="game-home-btn-icon" />
      </button>

      <div className="iframe-wrap">
        {!isReady || !iframeSrc ? (
          <LoadingScreen message="Connecting wallet" />
        ) : (
          <iframe
            ref={iframeRef}
            src={iframeSrc}
            title={game.name}
            allow="fullscreen; autoplay"
            allowFullScreen
            className={`game-iframe${gameReady ? "" : " game-iframe--preparing"}`}
            onLoad={scheduleLoadFallback}
          />
        )}

        <LeaderboardSubmitToast
          toast={submitToast}
          onDismiss={dismissSubmitToast}
        />

        {pendingSubmitScore != null && (
          <div className="lb-submit-confirm" role="dialog" aria-modal="true">
            <div className="lb-submit-confirm__card">
              <button
                type="button"
                className="lb-submit-confirm__close"
                onClick={cancelPendingSubmit}
                disabled={payingSubmit}
                aria-label="Close"
              >
                ✕
              </button>
              <h3 className="lb-submit-confirm__title">
                Submit score to enter Contest
              </h3>
              <p className="lb-submit-confirm__score">
                {pendingSubmitScore.toLocaleString()}
              </p>
              <p className="lb-submit-confirm__hint">
                {contestLive
                  ? "Submit this score to appear on the contest leaderboard. Pay $0.05 in USDT or USDC. MiniPay will ask you to confirm once."
                  : "Pay $0.05 in USDT or USDC. MiniPay will ask you to confirm once."}
              </p>
              <button
                type="button"
                className={`lb-submit-confirm__pay${
                  contestLive
                    ? " lb-submit-confirm__pay--live"
                    : " lb-submit-confirm__pay--offline"
                }`}
                onClick={() => void confirmPendingSubmit()}
                disabled={payingSubmit}
              >
                {payingSubmit ? "Opening wallet…" : "Pay & Submit"}
              </button>
              <p
                className={`lb-submit-confirm__contest-status${
                  contestLive
                    ? " lb-submit-confirm__contest-status--live"
                    : " lb-submit-confirm__contest-status--offline"
                }`}
                role="status"
              >
                {contestLive ? "Contest is live" : "Contest is not live"}
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
