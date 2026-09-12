import {
  ActivityCounters,
  ActivityLeaderboardEntry,
} from "@/lib/activity-week";
import { walletAuthHeaders } from "@/lib/wallet-session-client";

export interface ActivityLeaderboardResponse {
  weekId: string;
  startsAt: number;
  endsAt: number;
  isCurrent: boolean;
  resetsIn: string | null;
  endsAtMs: number;
  entries: ActivityLeaderboardEntry[];
  me: {
    rank: number | null;
    score: number;
    activeDays: number;
  } | null;
}

export async function getActivityLeaderboard(opts?: {
  walletAddress?: string;
  week?: "current" | "prev" | string;
}): Promise<ActivityLeaderboardResponse> {
  const params = new URLSearchParams();
  if (opts?.walletAddress) params.set("wallet", opts.walletAddress);
  if (opts?.week) params.set("week", opts.week);
  const qs = params.toString();

  const res = await fetch(
    `/api/leaderboard/activity${qs ? `?${qs}` : ""}`,
    { cache: "no-store" }
  );
  const data = (await res.json()) as ActivityLeaderboardResponse & {
    error?: string;
  };

  if (!res.ok) {
    throw new Error(data.error ?? "Could not load activity leaderboard.");
  }

  return {
    weekId: data.weekId,
    startsAt: data.startsAt ?? 0,
    endsAt: data.endsAt ?? 0,
    isCurrent: Boolean(data.isCurrent),
    resetsIn: data.resetsIn ?? null,
    endsAtMs: data.endsAtMs ?? data.endsAt ?? 0,
    entries: data.entries ?? [],
    me: data.me ?? null,
  };
}

export async function pingActivityVisit(
  walletAddress: string
): Promise<void> {
  try {
    await fetch("/api/activity/ping", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...walletAuthHeaders(),
      },
      body: JSON.stringify({ walletAddress }),
      cache: "no-store",
    });
  } catch {
    // Best-effort
  }
}

export type { ActivityCounters, ActivityLeaderboardEntry };
