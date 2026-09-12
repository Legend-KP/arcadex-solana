import { GameProgress } from "@/types";
import { walletAuthHeaders } from "@/lib/wallet-session-client";

export interface GameProgressResponse {
  progress: GameProgress;
  hasLeaderboard: boolean;
  modes?: Record<string, number> | null;
}

/** Shell-side throttle — Unity direct HTTP is capped server-side. */
const PROGRESS_CLIENT_MIN_INTERVAL_MS = 10_000;

const lastProgressFetchAt = new Map<string, number>();
const lastProgressResponse = new Map<string, GameProgressResponse>();

function progressClientKey(gameId: string, walletAddress: string): string {
  return `${gameId}:${walletAddress.toLowerCase()}`;
}

export async function getGameProgress(
  gameId: string,
  walletAddress: string,
  opts?: { playerName?: string; force?: boolean }
): Promise<GameProgressResponse> {
  const key = progressClientKey(gameId, walletAddress);
  const now = Date.now();
  const lastAt = lastProgressFetchAt.get(key) ?? 0;

  if (!opts?.force && now - lastAt < PROGRESS_CLIENT_MIN_INTERVAL_MS) {
    const cached = lastProgressResponse.get(key);
    if (cached) return cached;
  }

  const params = new URLSearchParams({ wallet: walletAddress });
  if (opts?.playerName?.trim()) {
    params.set("name", opts.playerName.trim());
  }
  const res = await fetch(`/api/games/${gameId}/progress?${params}`, {
    headers: walletAuthHeaders(),
  });
  const data = (await res.json()) as GameProgressResponse & { error?: string };

  if (!res.ok) {
    throw new Error(data.error ?? "Could not load game progress.");
  }

  const result = {
    progress: data.progress ?? {},
    hasLeaderboard: data.hasLeaderboard ?? true,
    modes: data.progress?.modes ?? data.modes ?? null,
  };

  lastProgressFetchAt.set(key, now);
  lastProgressResponse.set(key, result);

  return result;
}

export async function saveGameProgress(
  gameId: string,
  walletAddress: string,
  value: number,
  opts?: {
    playerName?: string;
    mode?: string;
    modes?: Record<string, number>;
    extras?: Record<string, unknown>;
  }
): Promise<GameProgressResponse & { success: boolean }> {
  const res = await fetch(`/api/games/${gameId}/progress`, {
    method: "POST",
    headers: walletAuthHeaders(),
    body: JSON.stringify({
      walletAddress,
      value,
      score: value,
      level: value,
      ...(opts?.playerName?.trim()
        ? { playerName: opts.playerName.trim() }
        : {}),
      ...(opts?.mode ? { mode: opts.mode } : {}),
      ...(opts?.modes ? { modes: opts.modes } : {}),
      ...(opts?.extras ? opts.extras : {}),
    }),
  });

  const data = (await res.json()) as GameProgressResponse & {
    success?: boolean;
    error?: string;
  };

  if (!res.ok) {
    throw new Error(data.error ?? "Could not save game progress.");
  }

  const result = {
    success: data.success ?? true,
    progress: data.progress ?? {},
    hasLeaderboard: data.hasLeaderboard ?? true,
    modes: data.progress?.modes ?? data.modes ?? null,
  };

  const key = progressClientKey(gameId, walletAddress);
  lastProgressFetchAt.set(key, Date.now());
  lastProgressResponse.set(key, result);

  return result;
}
