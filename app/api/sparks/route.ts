import { NextResponse } from "next/server";
import { readSparkStateFromServer } from "@/lib/player-backend";
import { computeSparkSnapshot } from "@/lib/spark";
import {
  checkRateLimit,
  getClientIp,
  rateLimitResponse,
} from "@/lib/rate-limit";
import { normalizeWalletAddress } from "@/lib/wallet-address";
import { requireWalletAuth } from "@/lib/wallet-session";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const ip = getClientIp(request);
  if (!(await checkRateLimit(`sparks-get:ip:${ip}`, 90, 60_000))) {
    return rateLimitResponse();
  }

  try {
    const { searchParams } = new URL(request.url);
    const rawWallet = searchParams.get("walletAddress")?.trim() ?? "";

    if (!rawWallet) {
      return NextResponse.json(
        { error: "walletAddress is required." },
        { status: 400 }
      );
    }

    const wallet = normalizeWalletAddress(rawWallet);
    if (!(await checkRateLimit(`sparks-get:wallet:${wallet}`, 60, 60_000))) {
      return rateLimitResponse();
    }

    const auth = await requireWalletAuth(request, wallet);
    if (!auth.ok) {
      return NextResponse.json(
        { error: auth.error },
        { status: auth.status }
      );
    }

    const state = await readSparkStateFromServer(wallet);
    const sparks = computeSparkSnapshot(state);
    return NextResponse.json({ state, sparks });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Failed to load sparks.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
