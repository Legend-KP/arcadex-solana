"use client";

import { DEFAULT_SHUFFLE_CAMPAIGN_ID } from "@/lib/daily-play-mode";
import { clearCachedStreakStatus } from "@/lib/streak-client-cache";
import {
  hasShuffleDoneToday,
  markShuffleDoneToday,
} from "@/lib/shuffle-done-today";
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
  nonce: string;
  outcome: {
    id: string;
    type: "usdt" | "spark" | "none";
    amount: number | null;
    label?: string;
  };
  theater: ShuffleTheaterCard[];
  needsClaim: boolean;
  /** True when returning an unclaimed prize from the last 24h. */
  resumed?: boolean;
};

export type ShuffleClaimResult = {
  ok: boolean;
  walletAddress: string;
  campaignId: number;
  nonce: string;
  outcome: {
    id: string;
    type: "usdt" | "spark" | "none";
    amount: number | null;
    label?: string;
  };
  needsClaim: boolean;
  infiniteSparkGranted: boolean;
  payoutSignature?: string | null;
  token?: string | null;
  alreadyClaimed?: boolean;
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
  if (!res.ok || !data.nonce) {
    throw new Error(data.error ?? "Could not prepare today's shuffle.");
  }
  return data;
}

export async function claimDailyShuffle(opts: {
  walletAddress: string;
  campaignId: number;
  nonce: string;
}): Promise<ShuffleClaimResult> {
  const res = await fetch("/api/shuffle/claim", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(opts),
    cache: "no-store",
  });
  const data = (await res.json().catch(() => ({}))) as ShuffleClaimResult & {
    error?: string;
  };
  if (!res.ok || !data.ok) {
    throw new Error(data.error ?? "Could not claim shuffle reward.");
  }
  if (data.token) setWalletSessionToken(data.token);
  clearCachedStreakStatus();
  return data;
}

/**
 * Prepare today's shuffle (server picks outcome). Claim happens on Continue
 * so the theater animation can run first.
 */
export async function performDailyShuffle(
  walletAddress: string,
  campaignId: number = DEFAULT_SHUFFLE_CAMPAIGN_ID
): Promise<ShufflePrepareResult> {
  if (hasShuffleDoneToday(walletAddress, campaignId)) {
    throw new Error(
      "Already shuffled in the last 24 hours. Come back later."
    );
  }
  const prepare = await prepareDailyShuffle(walletAddress, campaignId);
  return prepare;
}

export async function claimDailyShuffleReward(opts: {
  walletAddress: string;
  campaignId: number;
  nonce: string;
}): Promise<ShuffleClaimResult> {
  const result = await claimDailyShuffle(opts);
  markShuffleDoneToday(opts.walletAddress, opts.campaignId);
  return result;
}
