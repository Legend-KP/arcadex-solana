import { NextResponse } from "next/server";
import { DEFAULT_STREAK_CAMPAIGN_ID, getDailyPlayMode } from "@/lib/daily-play-mode";
import {
  checkRateLimit,
  getClientIp,
  rateLimitResponse,
} from "@/lib/rate-limit";
import { isSolanaAddress } from "@/lib/solana-address";
import { normalizeWalletAddress } from "@/lib/wallet-address";
import { createWalletSessionToken, isWalletAuthEnabled } from "@/lib/wallet-session";
import { applyStreakCheckIn } from "@/lib/daily-play-server";

export const dynamic = "force-dynamic";

/**
 * Off-chain daily streak check-in.
 * Active only when DAILY_PLAY_MODE=streak (UI is gated the same way).
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
    return NextResponse.json({
      ok: true,
      ...result,
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
