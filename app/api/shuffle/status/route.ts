import { NextResponse } from "next/server";
import { DEFAULT_SHUFFLE_CAMPAIGN_ID } from "@/lib/daily-play-mode";
import {
  checkRateLimit,
  getClientIp,
  rateLimitResponse,
} from "@/lib/rate-limit";
import { isSolanaAddress } from "@/lib/solana-address";
import { normalizeWalletAddress } from "@/lib/wallet-address";
import { hasCompletedShuffleToday } from "@/lib/daily-play-server";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const ip = getClientIp(request);
  if (!(await checkRateLimit(`shuffle-status:ip:${ip}`, 60, 60_000))) {
    return rateLimitResponse();
  }

  try {
    const url = new URL(request.url);
    const rawWallet = url.searchParams.get("walletAddress")?.trim() ?? "";
    const campaignId = Number(
      url.searchParams.get("campaignId") || DEFAULT_SHUFFLE_CAMPAIGN_ID
    );
    if (!rawWallet || !isSolanaAddress(rawWallet)) {
      return NextResponse.json(
        { error: "A valid Solana wallet is required.", code: "NO_WALLET" },
        { status: 400 }
      );
    }
    const wallet = normalizeWalletAddress(rawWallet);
    const done = await hasCompletedShuffleToday(wallet, campaignId);
    return NextResponse.json({
      ok: true,
      walletAddress: wallet,
      campaignId,
      canCheckIn: !done,
      currentDay: done ? 1 : 0,
      requiredDays: 1,
      lastCheckInAt: done ? Date.now() : 0,
      streakWouldReset: false,
      configured: true,
    });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Could not load shuffle status.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
