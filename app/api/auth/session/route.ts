import { NextResponse } from "next/server";
import {
  checkRateLimit,
  getClientIp,
  rateLimitResponse,
} from "@/lib/rate-limit";
import { isWalletAddress, normalizeWalletAddress } from "@/lib/wallet-address";
import {
  createWalletSessionToken,
  verifyWalletSignature,
} from "@/lib/wallet-session";

export const dynamic = "force-dynamic";

const SESSION_TTL_SEC = 24 * 60 * 60;

export async function POST(request: Request) {
  const ip = getClientIp(request);
  if (!(await checkRateLimit(`auth-session:${ip}`, 20, 60_000))) {
    return rateLimitResponse();
  }

  try {
    const body = (await request.json()) as {
      walletAddress?: string;
      message?: string;
      signature?: string;
    };

    const rawWallet = body.walletAddress?.trim() ?? "";
    const message = body.message?.trim() ?? "";
    const signature = body.signature?.trim() ?? "";

    if (!rawWallet || !isWalletAddress(rawWallet)) {
      return NextResponse.json(
        { error: "A valid walletAddress is required." },
        { status: 400 }
      );
    }

    if (!message || !signature) {
      return NextResponse.json(
        { error: "message and signature are required." },
        { status: 400 }
      );
    }

    const wallet = normalizeWalletAddress(rawWallet);
    const valid = await verifyWalletSignature(wallet, message, signature);
    if (!valid) {
      return NextResponse.json(
        { error: "Invalid or expired wallet signature." },
        { status: 401 }
      );
    }

    const token = await createWalletSessionToken(wallet);
    return NextResponse.json({
      token,
      walletAddress: wallet,
      expiresIn: SESSION_TTL_SEC,
    });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Failed to create session.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
