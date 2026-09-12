import { NextResponse } from "next/server";
import {
  DEFAULT_STREAK_CAMPAIGN_ID,
  isArcadeXRewardsConfigured,
} from "@/lib/arcadex-rewards";
import { verifyCheckInTx } from "@/lib/arcadex-rewards-verify";
import {
  checkRateLimit,
  getClientIp,
  rateLimitResponse,
} from "@/lib/rate-limit";
import {
  recordCheckInTxOnServer,
  StreakSyncError,
  grantStreakInfiniteSparkOnServer,
  StreakRewardError,
  recordActivityEventBestEffort,
} from "@/lib/player-backend";
import { isWalletAddress, normalizeWalletAddress } from "@/lib/wallet-address";
import { invalidateStreakProgressCache } from "@/lib/streak-progress-cache";
import { createWalletSessionToken } from "@/lib/wallet-session";
import type { Hash } from "viem";
import {
  canMintDailySession,
  hashDeviceId,
  markDailySessionDevice,
  readDeviceCookie,
} from "@/lib/device-binding";

export const dynamic = "force-dynamic";

const SESSION_TTL_SEC = 24 * 60 * 60;

/**
 * Verify an on-chain checkIn tx, bind a session JWT to that wallet, and
 * auto-grant Infinite Spark if the same tx emitted MilestoneReached.
 *
 * Attack surface closed by:
 * - on-chain msg.sender must match body wallet (via event)
 * - tx must hit ArcadeXRewards and include CheckedIn
 * - txHash can only be synced once per wallet (RTDB replay guard)
 * - JWT is minted only for the HttpOnly device cookie that loaded
 *   streak status before this check-in tx (not a Celoscan copy)
 */
export async function POST(request: Request) {
  const ip = getClientIp(request);
  if (!(await checkRateLimit(`streak-sync:${ip}`, 30, 60_000))) {
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

    let verified;
    try {
      verified = await verifyCheckInTx(wallet, txHash as Hash, campaignId);
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Invalid check-in transaction.";
      return NextResponse.json(
        { error: message, code: "INVALID_TX" },
        { status: 400 }
      );
    }

    await recordCheckInTxOnServer(wallet, txHash, verified.day, campaignId);
    await invalidateStreakProgressCache(wallet, campaignId);
    recordActivityEventBestEffort(wallet, "tx");

    let reward: {
      granted: boolean;
      sparks?: unknown;
      state?: unknown;
    } | null = null;

    if (verified.milestone) {
      try {
        const result = await grantStreakInfiniteSparkOnServer(
          wallet,
          txHash,
          campaignId
        );
        reward = {
          granted: result.granted,
          sparks: result.sparks,
          state: result.state,
        };
      } catch (err) {
        if (err instanceof StreakRewardError) {
          return NextResponse.json(
            { error: err.message, code: err.code },
            { status: err.code === "TX_ALREADY_USED" ? 409 : 400 }
          );
        }
        throw err;
      }
    }

    const deviceId = readDeviceCookie(request);
    const deviceHash = deviceId ? await hashDeviceId(deviceId) : null;
    const canMint =
      Boolean(deviceHash) &&
      (await canMintDailySession({
        wallet,
        deviceHash: deviceHash!,
        txTimestamp: verified.timestamp,
      }));

    if (!canMint || !deviceHash) {
      return NextResponse.json(
        {
          error: "Daily check-in must be finished in the same browser that started it.",
          code: "DEVICE_MISMATCH",
        },
        { status: 403 }
      );
    }

    await markDailySessionDevice(wallet, deviceHash);
    const token = await createWalletSessionToken(wallet);

    return NextResponse.json({
      ok: true,
      walletAddress: wallet,
      day: verified.day,
      campaignId,
      milestone: Boolean(verified.milestone),
      token,
      expiresIn: SESSION_TTL_SEC,
      reward,
    });
  } catch (err) {
    if (err instanceof StreakSyncError) {
      return NextResponse.json(
        { error: err.message, code: err.code },
        { status: err.code === "TX_ALREADY_USED" ? 409 : 400 }
      );
    }

    const message =
      err instanceof Error ? err.message : "Failed to sync check-in.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
