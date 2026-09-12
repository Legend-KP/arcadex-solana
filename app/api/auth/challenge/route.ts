import { NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { buildAuthChallengeMessage } from "@/lib/wallet-auth-message";
import {
  checkRateLimit,
  getClientIp,
  rateLimitResponse,
} from "@/lib/rate-limit";
import { isWalletAddress, normalizeWalletAddress } from "@/lib/wallet-address";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const ip = getClientIp(request);
  if (!(await checkRateLimit(`auth-challenge:${ip}`, 30, 60_000))) {
    return rateLimitResponse();
  }

  try {
    const body = (await request.json()) as { walletAddress?: string };
    const rawWallet = body.walletAddress?.trim() ?? "";

    if (!rawWallet || !isWalletAddress(rawWallet)) {
      return NextResponse.json(
        { error: "A valid walletAddress is required." },
        { status: 400 }
      );
    }

    const wallet = normalizeWalletAddress(rawWallet);
    const nonce = randomUUID();
    const issuedAt = new Date().toISOString();
    const message = buildAuthChallengeMessage(wallet, nonce, issuedAt);

    return NextResponse.json({ message, walletAddress: wallet, expiresAt: issuedAt });
  } catch {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }
}
