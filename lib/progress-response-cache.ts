import { GameProgress } from "@/types";

/** Minimum interval between fresh progress reads per wallet+game. */
export const PROGRESS_DEBOUNCE_MS = 8_000;

export type ProgressGetPayload = {
  progress: GameProgress;
  hasLeaderboard: boolean;
  highScore: number;
  score: number;
  level: number;
  modes?: Record<string, number> | null;
  easyLevel?: number;
  mediumLevel?: number;
  advancedLevel?: number;
};

type DebounceEntry = {
  payload: ProgressGetPayload;
  expiresAt: number;
};

const debounceCache = new Map<string, DebounceEntry>();

function debounceKey(gameId: string, wallet: string): string {
  return `${gameId}:${wallet.toLowerCase()}`;
}

export function getDebouncedProgressResponse(
  gameId: string,
  wallet: string
): ProgressGetPayload | null {
  const key = debounceKey(gameId, wallet);
  const entry = debounceCache.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    debounceCache.delete(key);
    return null;
  }
  return entry.payload;
}

export function setDebouncedProgressResponse(
  gameId: string,
  wallet: string,
  payload: ProgressGetPayload
): void {
  const key = debounceKey(gameId, wallet);
  debounceCache.set(key, {
    payload,
    expiresAt: Date.now() + PROGRESS_DEBOUNCE_MS,
  });
}
