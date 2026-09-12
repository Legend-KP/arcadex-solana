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

/** Authenticated home visit — marks an active day (idempotent per UTC day). */
export async function POST(request: Request) {
  const ip = getClientIp(request);
  if (!(await checkRateLimit(`activity-ping:${ip}`, 30, 60_000))) {
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

    await recordActivityEvent(wallet, "visit");
    return NextResponse.json({ ok: true });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Failed to record activity.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
