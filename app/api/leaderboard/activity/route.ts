import { NextResponse } from "next/server";
import {
  ACTIVITY_LEADERBOARD_MAX_ENTRIES,
  computeActivityXp,
  formatActivityCountdown,
} from "@/lib/activity-week";
import {
  checkRateLimit,
  getClientIp,
  rateLimitResponse,
} from "@/lib/rate-limit";
import {
  fetchActivityLeaderboardFromServer,
  fetchUserActivityFromServer,
  findActivityRank,
  resolveActivityWeekId,
} from "@/lib/player-backend";
import {
  isWalletAddress,
  normalizeWalletAddress,
} from "@/lib/wallet-address";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const ip = getClientIp(request);
  if (!(await checkRateLimit(`activity-lb:${ip}`, 60, 60_000))) {
    return rateLimitResponse();
  }

  try {
    const { searchParams } = new URL(request.url);
    const weekParam = searchParams.get("week") ?? searchParams.get("weekId");
    const walletRaw = searchParams.get("wallet")?.trim() ?? "";
    const week = resolveActivityWeekId(weekParam);

    const entries = await fetchActivityLeaderboardFromServer(
      week.weekId,
      ACTIVITY_LEADERBOARD_MAX_ENTRIES
    );

    let me: {
      rank: number | null;
      score: number;
      activeDays: number;
    } | null = null;

    if (walletRaw && isWalletAddress(walletRaw)) {
      const wallet = normalizeWalletAddress(walletRaw);
      const stats = await fetchUserActivityFromServer(wallet, week.weekId);
      const xp = computeActivityXp(stats);
      const rankInTop =
        stats.sparksSpent > 0 ? findActivityRank(entries, wallet) : null;
      me = {
        rank: rankInTop,
        score: xp,
        activeDays: stats.activeDays,
      };
    }

    const remainingMs = week.endsAt > 0 ? week.endsAt - Date.now() : 0;

    return NextResponse.json({
      weekId: week.weekId,
      startsAt: week.startsAt,
      endsAt: week.endsAt,
      isCurrent: week.isCurrent,
      resetsIn: week.isCurrent ? formatActivityCountdown(remainingMs) : null,
      endsAtMs: week.endsAt,
      entries,
      me,
    });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Failed to load activity leaderboard.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
