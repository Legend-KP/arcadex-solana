import { NextResponse } from "next/server";
import { spendSparkOnServer, SparkSpendError } from "@/lib/player-backend";
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
  if (!(await checkRateLimit(`sparks-spend:${ip}`, 60, 60_000))) {
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

    const result = await spendSparkOnServer(wallet);
    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof SparkSpendError) {
      return NextResponse.json(
        { error: err.message, code: err.code },
        { status: err.code === "NO_SPARKS" ? 402 : 400 }
      );
    }

    const message =
      err instanceof Error ? err.message : "Failed to spend Spark.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
