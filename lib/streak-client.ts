"use client";

import {
  DEFAULT_STREAK_CAMPAIGN_ID,
} from "@/lib/arcadex-rewards";
import { getDailyCampaignId } from "@/lib/daily-play-mode";
import { checkInOnChain } from "@/lib/arcadex-rewards-check-in";
import {
  clearCachedStreakStatus,
  readCachedStreakStatus,
  shouldUseCachedStreakStatus,
  writeCachedStreakStatus,
} from "@/lib/streak-client-cache";
import { setWalletSessionToken, walletAuthHeaders } from "@/lib/wallet-session-client";
import type { SparkSnapshot, StoredSparkState } from "@/types";

export interface StreakStatus {
  configured: boolean;
  campaignId: number;
  currentDay: number;
  lastCheckInAt: number;
  milestoneReached: boolean;
  onChainClaimed: boolean;
  initialized?: boolean;
  canCheckIn: boolean;
  streakWouldReset: boolean;
  campaign: {
    active: boolean;
    cancelled?: boolean;
    requireEligibility?: boolean;
    campaignType?: number;
    requiredDays: number;
    minIntervalSeconds: number;
    maxClaims?: number;
    startTime?: number;
    endTime?: number;
    rewardMode: number;
    resetAfterMilestone: boolean;
    maxSinglePayout?: string;
  };
}

export async function fetchStreakStatus(
  walletAddress: string,
  campaignId: number = getDailyCampaignId(),
  opts?: { fresh?: boolean }
): Promise<StreakStatus> {
  if (!opts?.fresh) {
    const cached = readCachedStreakStatus(walletAddress, campaignId);
    if (
      cached &&
      Number(cached.campaignId) === Number(campaignId) &&
      shouldUseCachedStreakStatus(cached)
    ) {
      return cached;
    }
  } else {
    clearCachedStreakStatus();
  }

  const params = new URLSearchParams({
    walletAddress,
    campaignId: String(campaignId),
  });
  if (opts?.fresh) params.set("fresh", "1");

  const res = await fetch(`/api/streak/status?${params}`, { cache: "no-store" });
  const data = (await res.json().catch(() => ({}))) as StreakStatus & {
    error?: string;
  };

  if (!res.ok) {
    throw new Error(data.error ?? "Could not load streak status.");
  }

  writeCachedStreakStatus(walletAddress, data);
  return data;
}

/** True when the wallet already checked in today (TooSoon / interval not elapsed). */
export function isAlreadyCheckedInError(error: unknown): boolean {
  const message =
    error instanceof Error
      ? `${error.message} ${error.cause instanceof Error ? error.cause.message : ""}`
      : String(error);
  const lower = message.toLowerCase();
  return (
    lower.includes("toosoon") ||
    lower.includes("too soon") ||
    lower.includes("spintoosoon") ||
    lower.includes("spin too soon") ||
    lower.includes("already checked") ||
    lower.includes("already shuffled") ||
    lower.includes("streakcomplete") ||
    lower.includes("streak complete")
  );
}

export interface StreakSyncResult {
  ok: boolean;
  walletAddress: string;
  day: number;
  campaignId: number;
  milestone: boolean;
  token: string;
  expiresIn: number;
  reward: {
    granted: boolean;
    sparks?: SparkSnapshot;
    state?: StoredSparkState;
  } | null;
}

export async function syncStreakCheckIn(opts: {
  walletAddress: string;
  txHash: string;
  campaignId?: number;
}): Promise<StreakSyncResult> {
  const res = await fetch("/api/streak/sync", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      walletAddress: opts.walletAddress,
      txHash: opts.txHash,
      campaignId: opts.campaignId ?? DEFAULT_STREAK_CAMPAIGN_ID,
    }),
    cache: "no-store",
  });

  const data = (await res.json().catch(() => ({}))) as StreakSyncResult & {
    error?: string;
  };

  if (!res.ok || !data.token) {
    throw new Error(data.error ?? "Could not sync check-in.");
  }

  setWalletSessionToken(data.token);
  clearCachedStreakStatus();
  return data;
}

export class SessionRefreshError extends Error {
  constructor(
    message: string,
    public readonly code?: string
  ) {
    super(message);
    this.name = "SessionRefreshError";
  }
}

/**
 * Silent session mint from a recent on-chain daily check-in.
 * Prefer this over personal_sign when the user already checked in today.
 */
export async function refreshSessionFromCheckIn(
  walletAddress: string,
  campaignId: number = getDailyCampaignId()
): Promise<string> {
  const res = await fetch("/api/streak/session", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ walletAddress, campaignId }),
    cache: "no-store",
  });

  const data = (await res.json().catch(() => ({}))) as {
    token?: string;
    error?: string;
    code?: string;
  };

  if (!res.ok || !data.token) {
    throw new SessionRefreshError(
      data.error ?? "Could not restore your session from daily check-in.",
      data.code
    );
  }

  setWalletSessionToken(data.token);
  return data.token;
}

async function sessionFromExistingCheckIn(
  walletAddress: string,
  campaignId: number
): Promise<StreakSyncResult> {
  const token = await refreshSessionFromCheckIn(walletAddress, campaignId);
  const status = await fetchStreakStatus(walletAddress, campaignId, {
    fresh: true,
  });

  return {
    ok: true,
    walletAddress,
    day: status.currentDay,
    campaignId,
    milestone: status.milestoneReached,
    token,
    expiresIn: 24 * 60 * 60,
    reward: null,
  };
}

/**
 * Primary MiniPay sign-in: on-chain `checkIn` on ArcadeXRewards
 * (`0xc5BE4773D5B4a8e3C6f3E7a4C5f7cfBC38986ccF`) + `/api/streak/sync` JWT.
 *
 * If the wallet already checked in today (tx on CeloScan but app never got a
 * session), recovers via `/api/streak/session` instead of trapping the user.
 */
export async function performDailyCheckIn(
  walletAddress: string,
  campaignId: number = DEFAULT_STREAK_CAMPAIGN_ID
): Promise<StreakSyncResult> {
  try {
    const { txHash } = await checkInOnChain(campaignId);
    return await syncStreakCheckIn({ walletAddress, txHash, campaignId });
  } catch (err) {
    if (isAlreadyCheckedInError(err)) {
      return sessionFromExistingCheckIn(walletAddress, campaignId);
    }

    // RPC flake after a successful MiniPay submit, or sync failure: if chain
    // already shows today's check-in, mint the session and let them in.
    try {
      const status = await fetchStreakStatus(walletAddress, campaignId, {
        fresh: true,
      });
      if (!status.canCheckIn && status.lastCheckInAt > 0) {
        return await sessionFromExistingCheckIn(walletAddress, campaignId);
      }
    } catch {
      // Fall through to original error
    }

    throw err;
  }
}

/** Alias — daily streak check-in is the app's wallet sign-in. */
export const signInWithDailyCheckIn = performDailyCheckIn;

export async function grantStreakReward(opts: {
  walletAddress: string;
  txHash: string;
  campaignId?: number;
}) {
  const res = await fetch("/api/streak/grant-reward", {
    method: "POST",
    headers: walletAuthHeaders(),
    body: JSON.stringify({
      walletAddress: opts.walletAddress,
      txHash: opts.txHash,
      campaignId: opts.campaignId ?? DEFAULT_STREAK_CAMPAIGN_ID,
    }),
    cache: "no-store",
  });

  const data = (await res.json().catch(() => ({}))) as {
    ok?: boolean;
    granted?: boolean;
    error?: string;
  };

  if (!res.ok) {
    throw new Error(data.error ?? "Could not grant streak reward.");
  }

  return data;
}
