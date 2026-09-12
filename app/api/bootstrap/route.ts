import { NextResponse } from "next/server";
import { bootstrapUserOnServer } from "@/lib/player-backend";
import {
  checkRateLimit,
  getClientIp,
  rateLimitResponse,
} from "@/lib/rate-limit";
import { normalizeWalletAddress } from "@/lib/wallet-address";
import { requireWalletAuth } from "@/lib/wallet-session";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const ip = getClientIp(request);
  if (!(await checkRateLimit(`bootstrap:${ip}`, 30, 60_000))) {
    return rateLimitResponse();
  }

  try {
    const body = (await request.json()) as {
      walletAddress?: string;
    };

    const rawWallet = body.walletAddress?.trim() ?? "";
    if (!rawWallet) {
      return NextResponse.json(
        { error: "walletAddress is required." },
        { status: 400 }
      );
    }

    const wallet = normalizeWalletAddress(rawWallet);
    const auth = await requireWalletAuth(request, wallet);
    if (!auth.ok) {
      return NextResponse.json({ error: auth.error }, { status: auth.status });
    }

    const user = await bootstrapUserOnServer(wallet);
    return NextResponse.json({ user });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Failed to bootstrap user.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
