import { NextResponse } from "next/server";
import {
  DEFAULT_STREAK_CAMPAIGN_ID,
  isArcadeXRewardsConfigured,
} from "@/lib/arcadex-rewards";
import {
  checkRateLimit,
  getClientIp,
  rateLimitResponse,
} from "@/lib/rate-limit";
import {
  grantStreakInfiniteSparkOnServer,
  StreakRewardError,
} from "@/lib/player-backend";
import { isWalletAddress, normalizeWalletAddress } from "@/lib/wallet-address";
import { requireWalletAuth } from "@/lib/wallet-session";

export const dynamic = "force-dynamic";

/**
 * Explicit grant endpoint (also auto-run from /api/streak/sync on day 7).
 * Requires wallet session OR will still verify on-chain milestone binding.
 * Session must match body wallet when auth is enabled — blocks cross-wallet abuse.
 */
export async function POST(request: Request) {
  const ip = getClientIp(request);
  if (!(await checkRateLimit(`streak-grant:${ip}`, 20, 60_000))) {
    return rateLimitResponse();
  }

  try {
    if (!isArcadeXRewardsConfigured()) {
      return NextResponse.json(
        { error: "Streak rewards are not configured yet.", code: "NOT_CONFIGURED" },
        { status: 503 }
      );
    }

    const body = (await request.json()) as {
      walletAddress?: string;
      txHash?: string;
      campaignId?: number;
    };

    const rawWallet = body.walletAddress?.trim() ?? "";
    const txHash = body.txHash?.trim() ?? "";
    const campaignId =
      typeof body.campaignId === "number" && Number.isFinite(body.campaignId)
        ? body.campaignId
        : DEFAULT_STREAK_CAMPAIGN_ID;

    if (!rawWallet || !isWalletAddress(rawWallet)) {
      return NextResponse.json(
        { error: "walletAddress is required.", code: "NO_WALLET" },
        { status: 400 }
      );
    }

    if (!txHash || !/^0x[a-fA-F0-9]{64}$/.test(txHash)) {
      return NextResponse.json(
        { error: "txHash is required.", code: "INVALID_TX" },
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

    const result = await grantStreakInfiniteSparkOnServer(
      wallet,
      txHash,
      campaignId
    );

    return NextResponse.json({
      ok: true,
      granted: result.granted,
      state: result.state,
      sparks: result.sparks,
    });
  } catch (err) {
    if (err instanceof StreakRewardError) {
      return NextResponse.json(
        { error: err.message, code: err.code },
        {
          status:
            err.code === "TX_ALREADY_USED"
              ? 409
              : err.code === "NO_MILESTONE"
                ? 400
                : 400,
        }
      );
    }

    const message =
      err instanceof Error ? err.message : "Failed to grant streak reward.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
