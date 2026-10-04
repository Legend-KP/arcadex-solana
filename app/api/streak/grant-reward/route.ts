import { NextResponse } from "next/server";
import { DEFAULT_STREAK_CAMPAIGN_ID, getDailyPlayMode } from "@/lib/daily-play-mode";
import { grantStreakInfiniteSpark } from "@/lib/daily-play-server";
import {
  checkRateLimit,
  getClientIp,
  rateLimitResponse,
} from "@/lib/rate-limit";
import { isSolanaAddress } from "@/lib/solana-address";
import { normalizeWalletAddress } from "@/lib/wallet-address";

export const dynamic = "force-dynamic";

/**
 * Grant Infinite Spark for a completed streak milestone (off-chain).
 * Idempotent per UTC day — safe retry after Day 7 check-in.
 */
export async function POST(request: Request) {
  const ip = getClientIp(request);
  if (!(await checkRateLimit(`streak-grant:ip:${ip}`, 20, 60_000))) {
    return rateLimitResponse();
  }

  try {
    if (getDailyPlayMode() !== "streak") {
      return NextResponse.json(
        {
          error: "Streak mode is not active.",
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
    const grant = await grantStreakInfiniteSpark(wallet, campaignId);

    return NextResponse.json({
      ok: true,
      granted: grant.granted,
      alreadyGranted: grant.alreadyGranted,
      infiniteUntil: grant.infiniteUntil,
    });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Could not grant streak reward.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
