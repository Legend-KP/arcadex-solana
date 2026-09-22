import { NextResponse } from "next/server";
import { DEFAULT_STREAK_CAMPAIGN_ID } from "@/lib/daily-play-mode";
import {
  checkRateLimit,
  getClientIp,
  rateLimitResponse,
} from "@/lib/rate-limit";
import { isSolanaAddress } from "@/lib/solana-address";
import { normalizeWalletAddress } from "@/lib/wallet-address";
import {
  deriveStreakStatus,
  getStreakProgress,
} from "@/lib/daily-play-server";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const ip = getClientIp(request);
  if (!(await checkRateLimit(`streak-status:ip:${ip}`, 60, 60_000))) {
    return rateLimitResponse();
  }

  try {
    const url = new URL(request.url);
    const rawWallet = url.searchParams.get("walletAddress")?.trim() ?? "";
    const campaignId = Number(
      url.searchParams.get("campaignId") || DEFAULT_STREAK_CAMPAIGN_ID
    );

    if (!rawWallet || !isSolanaAddress(rawWallet)) {
      return NextResponse.json(
        { error: "A valid Solana wallet is required.", code: "NO_WALLET" },
        { status: 400 }
      );
    }
    const wallet = normalizeWalletAddress(rawWallet);
    const progress = await getStreakProgress(wallet, campaignId);
    const status = deriveStreakStatus(progress);

    return NextResponse.json({
      ok: true,
      walletAddress: wallet,
      campaignId,
      currentDay: status.currentDay,
      requiredDays: status.requiredDays,
      lastCheckInAt: status.lastCheckInAt,
      canCheckIn: status.canCheckIn,
      streakWouldReset: status.streakWouldReset,
      milestoneClaimed: status.milestoneClaimed,
      /** Alias used by legacy shuffle UI that reused streak status. */
      configured: true,
    });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Could not load streak status.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
