import { NextResponse } from "next/server";
import type { Hash } from "viem";
import {
  REWARD_OFFCHAIN,
  REWARD_USDT,
  isArcadeXRewardsConfigured,
} from "@/lib/arcadex-rewards";
import { verifySpinTx } from "@/lib/arcadex-rewards-verify";
import { DEFAULT_SHUFFLE_CAMPAIGN_ID } from "@/lib/daily-play-mode";
import {
  checkRateLimit,
  getClientIp,
  rateLimitResponse,
} from "@/lib/rate-limit";
import {
  confirmShuffleUsdtBudget,
  getShufflePending,
  grantShuffleInfiniteSparkOnServer,
  markShufflePendingConsumed,
  recordSpinTxOnServer,
  shuffleUsdtReservationKey,
  StreakRewardError,
  StreakSyncError,
  recordActivityEventBestEffort,
} from "@/lib/player-backend";
import { usdtToMicro } from "@/lib/shuffle-outcomes";
import { invalidateStreakProgressCache } from "@/lib/streak-progress-cache";
import { isWalletAddress, normalizeWalletAddress } from "@/lib/wallet-address";
import { createWalletSessionToken } from "@/lib/wallet-session";
import {
  canMintDailySession,
  hashDeviceId,
  markDailySessionDevice,
  readDeviceCookie,
} from "@/lib/device-binding";

export const dynamic = "force-dynamic";

const SESSION_TTL_SEC = 24 * 60 * 60;

export async function POST(request: Request) {
  const ip = getClientIp(request);
  if (!(await checkRateLimit(`shuffle-sync:${ip}`, 30, 60_000))) {
    return rateLimitResponse();
  }

  try {
    if (!isArcadeXRewardsConfigured()) {
      return NextResponse.json(
        { error: "Rewards contract not configured.", code: "NOT_CONFIGURED" },
        { status: 503 }
      );
    }

    const body = (await request.json()) as {
      walletAddress?: string;
      txHash?: string;
      campaignId?: number;
      nonce?: number;
    };

    const rawWallet = body.walletAddress?.trim() ?? "";
    const txHash = body.txHash?.trim() ?? "";
    const campaignId =
      typeof body.campaignId === "number" && Number.isFinite(body.campaignId)
        ? body.campaignId
        : DEFAULT_SHUFFLE_CAMPAIGN_ID;
    const nonce =
      typeof body.nonce === "number" && Number.isFinite(body.nonce)
        ? body.nonce
        : -1;

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
    if (nonce < 0) {
      return NextResponse.json(
        { error: "nonce is required.", code: "INVALID_NONCE" },
        { status: 400 }
      );
    }

    const wallet = normalizeWalletAddress(rawWallet);
    const pending = await getShufflePending(wallet, campaignId, nonce);
    if (!pending) {
      return NextResponse.json(
        { error: "No pending shuffle for this nonce.", code: "NO_PENDING" },
        { status: 400 }
      );
    }

    let verified;
    try {
      verified = await verifySpinTx(wallet, txHash as Hash, campaignId);
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Invalid spin transaction.";
      return NextResponse.json(
        { error: message, code: "INVALID_TX" },
        { status: 400 }
      );
    }

    if (Number(verified.rewardMode) !== pending.rewardMode) {
      return NextResponse.json(
        { error: "On-chain reward does not match prepared outcome.", code: "MISMATCH" },
        { status: 400 }
      );
    }
    if (verified.rewardAmount.toString() !== pending.rewardAmount) {
      return NextResponse.json(
        { error: "On-chain amount does not match prepared outcome.", code: "MISMATCH" },
        { status: 400 }
      );
    }

    await recordSpinTxOnServer(wallet, txHash, campaignId, pending.outcomeId);
    recordActivityEventBestEffort(wallet, "tx");
    await markShufflePendingConsumed(wallet, campaignId, nonce, txHash);
    await invalidateStreakProgressCache(wallet, campaignId);

    let infiniteSparkGranted = false;
    let reward: { granted: boolean; sparks?: unknown; state?: unknown } | null =
      null;

    if (
      pending.outcomeType === "spark" &&
      Number(verified.rewardMode) === REWARD_OFFCHAIN
    ) {
      try {
        const result = await grantShuffleInfiniteSparkOnServer(wallet, txHash);
        infiniteSparkGranted = result.granted || Boolean(result.state.infiniteUntil);
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

    if (pending.outcomeType === "usdt" && Number(verified.rewardMode) === REWARD_USDT) {
      const amountMicro =
        pending.displayAmount != null
          ? usdtToMicro(pending.displayAmount)
          : Number(verified.rewardAmount);
      await confirmShuffleUsdtBudget({
        amountMicro,
        reservationKey: shuffleUsdtReservationKey(wallet, campaignId, nonce),
      });
    }

    const deviceId = readDeviceCookie(request);
    const deviceHash = deviceId ? await hashDeviceId(deviceId) : null;
    const pendingHash = pending.deviceHash;
    const deviceMatchesPending =
      Boolean(deviceHash) &&
      Boolean(pendingHash) &&
      deviceHash === pendingHash;
    const canMint =
      Boolean(deviceHash) &&
      (deviceMatchesPending ||
        (await canMintDailySession({
          wallet,
          deviceHash: deviceHash!,
          txTimestamp: verified.timestamp,
        })));

    if (!canMint || !deviceHash) {
      return NextResponse.json(
        {
          error: "Daily shuffle must be finished in the same browser that started it.",
          code: "DEVICE_MISMATCH",
        },
        { status: 403 }
      );
    }

    await markDailySessionDevice(wallet, deviceHash);
    const token = await createWalletSessionToken(wallet);

    const needsClaim =
      pending.outcomeType === "usdt" &&
      Number(verified.rewardMode) === REWARD_USDT;

    return NextResponse.json({
      ok: true,
      walletAddress: wallet,
      campaignId,
      nonce,
      token,
      expiresIn: SESSION_TTL_SEC,
      outcome: {
        id: pending.outcomeId,
        type: pending.outcomeType,
        amount: pending.displayAmount,
      },
      needsClaim,
      infiniteSparkGranted,
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
      err instanceof Error ? err.message : "Failed to sync shuffle.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
