"use client";

import type { Address, Hex } from "viem";
import {
  claimShuffleRewardOnChain,
  spinOnChain,
} from "@/lib/arcadex-rewards-spin";
import { DEFAULT_SHUFFLE_CAMPAIGN_ID } from "@/lib/daily-play-mode";
import {
  clearCachedStreakStatus,
} from "@/lib/streak-client-cache";
import {
  hasShuffleDoneToday,
  markShuffleDoneToday,
} from "@/lib/shuffle-done-today";
import {
  fetchStreakStatus,
  isAlreadyCheckedInError,
  refreshSessionFromCheckIn,
  type StreakStatus,
} from "@/lib/streak-client";
import { setWalletSessionToken } from "@/lib/wallet-session-client";

export type ShuffleTheaterCard = {
  id: string;
  type: "usdt" | "spark" | "none";
  amount: number | null;
  label: string;
  sub: string;
  glyph: string;
  rarity: string;
};

export type ShufflePrepareResult = {
  ok: boolean;
  campaignId: number;
  nonce: number;
  deadline: number;
  signature: Hex;
  rewardMode: number;
  rewardTarget: Address;
  rewardAmount: string;
  outcome: {
    id: string;
    type: "usdt" | "spark" | "none";
    amount: number | null;
  };
  theater: ShuffleTheaterCard[];
};

export type ShuffleSyncResult = {
  ok: boolean;
  walletAddress: string;
  campaignId: number;
  nonce: number;
  token: string;
  expiresIn: number;
  outcome: {
    id: string;
    type: "usdt" | "spark" | "none";
    amount: number | null;
  };
  needsClaim: boolean;
  infiniteSparkGranted: boolean;
  reward: { granted: boolean } | null;
};

export async function prepareDailyShuffle(
  walletAddress: string,
  campaignId: number = DEFAULT_SHUFFLE_CAMPAIGN_ID
): Promise<ShufflePrepareResult> {
  const res = await fetch("/api/shuffle/prepare", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ walletAddress, campaignId }),
    cache: "no-store",
  });
  const data = (await res.json().catch(() => ({}))) as ShufflePrepareResult & {
    error?: string;
    code?: string;
  };
  if (!res.ok || !data.signature) {
    throw new Error(data.error ?? "Could not prepare today's shuffle.");
  }
  return data;
}

export async function syncShuffleSpin(opts: {
  walletAddress: string;
  txHash: string;
  campaignId: number;
  nonce: number;
}): Promise<ShuffleSyncResult> {
  const res = await fetch("/api/shuffle/sync", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(opts),
    cache: "no-store",
  });
  const data = (await res.json().catch(() => ({}))) as ShuffleSyncResult & {
    error?: string;
  };
  if (!res.ok || !data.token) {
    throw new Error(data.error ?? "Could not sync shuffle.");
  }
  setWalletSessionToken(data.token);
  clearCachedStreakStatus();
  return data;
}

/**
 * Primary MiniPay sign-in when NEXT_PUBLIC_DAILY_PLAY_MODE=shuffle:
 * prepare → spin() → sync JWT (+ optional Infinite Spark).
 */
export async function performDailyShuffle(
  walletAddress: string,
  campaignId: number = DEFAULT_SHUFFLE_CAMPAIGN_ID
): Promise<{
  prepare: ShufflePrepareResult;
  sync: ShuffleSyncResult;
  txHash: string;
}> {
  if (hasShuffleDoneToday(walletAddress, campaignId)) {
    throw new Error("Already shuffled today. Come back after the daily interval.");
  }

  const preStatus = await fetchStreakStatus(walletAddress, campaignId, {
    fresh: true,
  });
  if (!preStatus.canCheckIn) {
    markShuffleDoneToday(walletAddress, campaignId);
    try {
      await refreshSessionFromCheckIn(walletAddress, campaignId);
    } catch {
      // ignore
    }
    throw new Error("Already shuffled today. Come back after the daily interval.");
  }

  try {
    const prepare = await prepareDailyShuffle(walletAddress, campaignId);
    const { txHash } = await spinOnChain({
      campaignId: prepare.campaignId,
      rewardMode: prepare.rewardMode,
      rewardTarget: prepare.rewardTarget,
      rewardAmount: BigInt(prepare.rewardAmount),
      nonce: BigInt(prepare.nonce),
      deadline: BigInt(prepare.deadline),
      signature: prepare.signature,
    });
    const sync = await syncShuffleSpin({
      walletAddress,
      txHash,
      campaignId: prepare.campaignId,
      nonce: prepare.nonce,
    });
    markShuffleDoneToday(walletAddress, campaignId);
    return { prepare, sync, txHash };
  } catch (err) {
    if (isAlreadyCheckedInError(err)) {
      markShuffleDoneToday(walletAddress, campaignId);
      try {
        await refreshSessionFromCheckIn(walletAddress, campaignId);
      } catch {
        // ignore
      }
      throw err;
    }

    try {
      const status = await fetchStreakStatus(walletAddress, campaignId, {
        fresh: true,
      });
      if (!status.canCheckIn && status.lastCheckInAt > 0) {
        markShuffleDoneToday(walletAddress, campaignId);
        await refreshSessionFromCheckIn(walletAddress, campaignId);
      }
    } catch {
      // fall through
    }
    throw err;
  }
}

export async function claimDailyShuffleReward(
  campaignId: number = DEFAULT_SHUFFLE_CAMPAIGN_ID
) {
  return claimShuffleRewardOnChain(campaignId);
}

export type { StreakStatus };
