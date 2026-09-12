import { ContestInfo, LeaderboardEntry } from "@/types";
import { walletAuthHeaders } from "@/lib/wallet-session-client";

export interface LeaderboardStatus {
  entries: LeaderboardEntry[];
  personalBest?: number;
  submittedBest?: number;
  canSubmit?: boolean;
  contest?: ContestInfo | null;
}

export async function getLeaderboard(
  gameId: string,
  opts?: { walletAddress?: string; playerName?: string }
): Promise<LeaderboardStatus> {
  const params = new URLSearchParams();
  if (opts?.walletAddress) params.set("wallet", opts.walletAddress);
  if (opts?.playerName) params.set("name", opts.playerName);
  const qs = params.toString();

  const res = await fetch(
    `/api/games/${gameId}/leaderboard${qs ? `?${qs}` : ""}`,
    { cache: "no-store" }
  );
  const data = (await res.json()) as LeaderboardStatus & { error?: string };

  if (!res.ok) {
    throw new Error(data.error ?? "Could not load leaderboard.");
  }

  return {
    entries: data.entries ?? [],
    personalBest: data.personalBest,
    submittedBest: data.submittedBest,
    canSubmit: data.canSubmit,
    contest: data.contest ?? null,
  };
}

export async function getUserBestScore(
  gameId: string,
  opts: { walletAddress?: string; playerName?: string }
): Promise<number> {
  const status = await getLeaderboard(gameId, opts);
  return status.personalBest ?? 0;
}

export async function getUserSubmittedScore(
  gameId: string,
  opts: { walletAddress?: string; playerName?: string }
): Promise<number> {
  const status = await getLeaderboard(gameId, opts);
  return status.submittedBest ?? 0;
}

/** Saves personal best only — does not post to the public leaderboard. */
export async function submitScore(
  gameId: string,
  entry: LeaderboardEntry
): Promise<number> {
  const res = await fetch(`/api/games/${gameId}/leaderboard`, {
    method: "POST",
    headers: walletAuthHeaders(),
    body: JSON.stringify(entry),
  });

  const data = (await res.json()) as {
    personalBest?: number;
    error?: string;
  };
  if (!res.ok) {
    throw new Error(data.error ?? "Could not save score.");
  }

  return data.personalBest ?? entry.score;
}

export async function submitScoreToLeaderboard(
  gameId: string,
  opts: { walletAddress: string; txHash: string; score: number }
): Promise<{
  highScore: number;
  leaderboardScore: number;
}> {
  const res = await fetch(`/api/games/${gameId}/leaderboard/submit`, {
    method: "POST",
    headers: walletAuthHeaders(),
    body: JSON.stringify(opts),
  });

  const data = (await res.json()) as {
    highScore?: number;
    leaderboardScore?: number;
    error?: string;
    code?: string;
  };

  if (!res.ok) {
    throw new Error(data.error ?? "Could not submit score to leaderboard.");
  }

  return {
    highScore: data.highScore ?? 0,
    leaderboardScore: data.leaderboardScore ?? 0,
  };
}
