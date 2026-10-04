import { NextResponse } from "next/server";
import { ACTIVITY_XP_PER_CHECKIN } from "@/lib/activity-week";
import { DEFAULT_STREAK_CAMPAIGN_ID, getDailyPlayMode } from "@/lib/daily-play-mode";
import {
  applyStreakCheckIn,
  grantStreakInfiniteSpark,
} from "@/lib/daily-play-server";
import { recordActivityEvent } from "@/lib/player-backend";
import {
  checkRateLimit,
  getClientIp,
  rateLimitResponse,
} from "@/lib/rate-limit";
import { isSolanaAddress } from "@/lib/solana-address";
import { normalizeWalletAddress } from "@/lib/wallet-address";
import { createWalletSessionToken, isWalletAuthEnabled } from "@/lib/wallet-session";

export const dynamic = "force-dynamic";

/**
 * Off-chain daily streak check-in.
 * Active only when DAILY_PLAY_MODE=streak (UI is gated the same way).
 * Grants 10 XP every day; Day 7 also grants Infinite Spark for 24h.
 */
export async function POST(request: Request) {
  const ip = getClientIp(request);
  if (!(await checkRateLimit(`streak-checkin:ip:${ip}`, 30, 60_000))) {
    return rateLimitResponse();
  }

  try {
    if (getDailyPlayMode() !== "streak") {
      return NextResponse.json(
        {
          error: "Streak mode is not active. Set DAILY_PLAY_MODE=streak to enable.",
          code: "STREAK_INACTIVE",
        },
        { status: 503 }
      );
    }

    const body = (await request.json()) as {
      walletAddress?: string;
      campaignId?: number;
    };
    const rawWallet = body.walletAddress?.trim() ?? "";
    const campaignId =
      typeof body.campaignId === "number" && Number.isFinite(body.campaignId)
        ? body.campaignId
        : DEFAULT_STREAK_CAMPAIGN_ID;

    if (!rawWallet || !isSolanaAddress(rawWallet)) {
      return NextResponse.json(
        { error: "A valid Solana wallet is required.", code: "NO_WALLET" },
        { status: 400 }
      );
    }
    const wallet = normalizeWalletAddress(rawWallet);

    const result = await applyStreakCheckIn(wallet, campaignId);
    await recordActivityEvent(wallet, "checkin");

    let infiniteSparkGranted = false;
    let infiniteUntil: number | null = null;
    if (result.milestone) {
      const grant = await grantStreakInfiniteSpark(wallet, campaignId);
      infiniteSparkGranted = grant.granted || grant.alreadyGranted;
      infiniteUntil = grant.infiniteUntil;
    }

    return NextResponse.json({
      ok: true,
      ...result,
      xpGranted: ACTIVITY_XP_PER_CHECKIN,
      infiniteSparkGranted,
      infiniteUntil,
      token: isWalletAuthEnabled()
        ? await createWalletSessionToken(wallet)
        : null,
    });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Could not check in.";
    const status = /already checked in/i.test(message) ? 409 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
