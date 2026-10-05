import { NextResponse } from "next/server";
import {
  checkRateLimit,
  getClientIp,
  rateLimitResponse,
} from "@/lib/rate-limit";
import { recordActivityEvent } from "@/lib/player-backend";
import { normalizeWalletAddress } from "@/lib/wallet-address";
import { requireWalletAuth } from "@/lib/wallet-session";

export const dynamic = "force-dynamic";

/**
 * Authenticated game start. Sparks are spent on the device; this is what
 * credits weekly XP (10 per play, 5s cooldown).
 */
export async function POST(request: Request) {
  const ip = getClientIp(request);
  if (!(await checkRateLimit(`activity-play:${ip}`, 60, 60_000))) {
    return rateLimitResponse();
  }

  try {
    const body = (await request.json()) as { walletAddress?: string };
    const rawWallet = body.walletAddress?.trim() ?? "";
    if (!rawWallet) {
      return NextResponse.json(
        { error: "walletAddress is required.", code: "NO_WALLET" },
        { status: 400 }
      );
    }

    const wallet = normalizeWalletAddress(rawWallet);
    const auth = await requireWalletAuth(request, wallet);
    if (!auth.ok) {
      return NextResponse.json(
        { error: auth.error, code: "UNAUTHORIZED" },
        { status: auth.status }
      );
    }

    if (!(await checkRateLimit(`activity-play:wallet:${wallet}`, 40, 60_000))) {
      return rateLimitResponse();
    }

    await recordActivityEvent(wallet, "play");
    return NextResponse.json({ ok: true });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Failed to record play.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
