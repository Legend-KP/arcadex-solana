import type { LeaderboardSubmitUnityResult } from "@/lib/bridge";

const RESULT_PREFIX = "arcadex_lb_submit_result:";
const PENDING_PREFIX = "arcadex_lb_submit_pending:";
const RESULT_TTL_MS = 5 * 60 * 1000;
const PENDING_TTL_MS = 10 * 60 * 1000;

interface StoredSubmitResult extends LeaderboardSubmitUnityResult {
  at: number;
}

interface StoredPendingSubmit {
  score: number;
  at: number;
}

function resultKey(gameId: string): string {
  return `${RESULT_PREFIX}${gameId}`;
}

function pendingKey(gameId: string): string {
  return `${PENDING_PREFIX}${gameId}`;
}

export function setPendingLeaderboardSubmit(
  gameId: string,
  score: number
): void {
  if (typeof window === "undefined") return;
  const payload: StoredPendingSubmit = { score, at: Date.now() };
  sessionStorage.setItem(pendingKey(gameId), JSON.stringify(payload));
}

export function clearPendingLeaderboardSubmit(gameId: string): void {
  if (typeof window === "undefined") return;
  sessionStorage.removeItem(pendingKey(gameId));
}

export function getPendingLeaderboardSubmit(gameId: string): number | null {
  if (typeof window === "undefined") return null;
  const raw = sessionStorage.getItem(pendingKey(gameId));
  if (!raw) return null;

  try {
    const parsed = JSON.parse(raw) as StoredPendingSubmit;
    if (Date.now() - parsed.at > PENDING_TTL_MS) {
      sessionStorage.removeItem(pendingKey(gameId));
      return null;
    }
    return typeof parsed.score === "number" ? parsed.score : null;
  } catch {
    sessionStorage.removeItem(pendingKey(gameId));
    return null;
  }
}

export function storeLeaderboardSubmitResult(
  gameId: string,
  result: LeaderboardSubmitUnityResult
): void {
  if (typeof window === "undefined") return;
  const payload: StoredSubmitResult = { ...result, at: Date.now() };
  sessionStorage.setItem(resultKey(gameId), JSON.stringify(payload));
}

export function getLeaderboardSubmitResult(
  gameId: string
): LeaderboardSubmitUnityResult | null {
  if (typeof window === "undefined") return null;
  const raw = sessionStorage.getItem(resultKey(gameId));
  if (!raw) return null;

  try {
    const parsed = JSON.parse(raw) as StoredSubmitResult;
    if (Date.now() - parsed.at > RESULT_TTL_MS) {
      sessionStorage.removeItem(resultKey(gameId));
      return null;
    }

    return {
      success: parsed.success,
      highScore: parsed.highScore,
      leaderboardScore: parsed.leaderboardScore,
      error: parsed.error,
    };
  } catch {
    sessionStorage.removeItem(resultKey(gameId));
    return null;
  }
}

export function clearLeaderboardSubmitResult(gameId: string): void {
  if (typeof window === "undefined") return;
  sessionStorage.removeItem(resultKey(gameId));
}
