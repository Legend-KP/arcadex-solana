"use client";

import { DEFAULT_STREAK_CAMPAIGN_ID } from "@/lib/daily-play-mode";
import {
  clearCachedStreakStatus,
  readCachedStreakStatus,
  shouldUseCachedStreakStatus,
  writeCachedStreakStatus,
} from "@/lib/streak-client-cache";
import { setWalletSessionToken } from "@/lib/wallet-session-client";

export type StreakStatus = {
  walletAddress?: string;
  campaignId: number;
  currentDay: number;
  requiredDays: number;
  lastCheckInAt: number;
  canCheckIn: boolean;
  streakWouldReset: boolean;
  milestoneClaimed?: boolean;
  configured?: boolean;
};

export async function fetchStreakStatus(
  walletAddress: string,
  campaignId: number = DEFAULT_STREAK_CAMPAIGN_ID,
  opts?: { fresh?: boolean; mode?: "streak" | "shuffle" }
): Promise<StreakStatus> {
  if (!opts?.fresh) {
    const cached = readCachedStreakStatus(walletAddress, campaignId);
    if (cached && shouldUseCachedStreakStatus(cached)) return cached;
  }

  const path =
    opts?.mode === "shuffle" ? "/api/shuffle/status" : "/api/streak/status";
  const url = new URL(path, window.location.origin);
  url.searchParams.set("walletAddress", walletAddress);
  url.searchParams.set("campaignId", String(campaignId));
  const res = await fetch(url.toString(), { cache: "no-store" });
  const data = (await res.json().catch(() => ({}))) as StreakStatus & {
    error?: string;
    ok?: boolean;
  };
  if (!res.ok) {
    throw new Error(data.error ?? "Could not load daily status.");
  }
  const status: StreakStatus = {
    walletAddress,
    campaignId,
    currentDay: Number(data.currentDay) || 0,
    requiredDays: Number(data.requiredDays) || 7,
    lastCheckInAt: Number(data.lastCheckInAt) || 0,
    canCheckIn: Boolean(data.canCheckIn),
    streakWouldReset: Boolean(data.streakWouldReset),
    milestoneClaimed: Boolean(data.milestoneClaimed),
    configured: data.configured !== false,
  };
  writeCachedStreakStatus(walletAddress, status);
  return status;
}

export async function performDailyCheckIn(
  walletAddress: string,
  campaignId: number = DEFAULT_STREAK_CAMPAIGN_ID
): Promise<{
  currentDay: number;
  requiredDays: number;
  milestone: boolean;
  lastCheckInAt: number;
  xpGranted: number;
  infiniteSparkGranted: boolean;
}> {
  const res = await fetch("/api/streak/check-in", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ walletAddress, campaignId }),
    cache: "no-store",
  });
  const data = (await res.json().catch(() => ({}))) as {
    error?: string;
    currentDay?: number;
    requiredDays?: number;
    milestone?: boolean;
    lastCheckInAt?: number;
    xpGranted?: number;
    infiniteSparkGranted?: boolean;
    token?: string | null;
  };
  if (!res.ok) {
    throw new Error(data.error ?? "Could not check in.");
  }
  if (data.token) setWalletSessionToken(data.token);
  clearCachedStreakStatus();
  return {
    currentDay: Number(data.currentDay) || 1,
    requiredDays: Number(data.requiredDays) || 7,
    milestone: Boolean(data.milestone),
    lastCheckInAt: Number(data.lastCheckInAt) || Date.now(),
    xpGranted: Number(data.xpGranted) || 10,
    infiniteSparkGranted: Boolean(data.infiniteSparkGranted),
  };
}

export async function grantStreakReward(
  walletAddress: string,
  campaignId: number = DEFAULT_STREAK_CAMPAIGN_ID
): Promise<{ granted: boolean }> {
  const res = await fetch("/api/streak/grant-reward", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ walletAddress, campaignId }),
    cache: "no-store",
  });
  const data = (await res.json().catch(() => ({}))) as {
    error?: string;
    granted?: boolean;
    alreadyGranted?: boolean;
  };
  if (!res.ok) {
    throw new Error(data.error ?? "Could not grant streak reward.");
  }
  return { granted: Boolean(data.granted || data.alreadyGranted) };
}

export function isAlreadyCheckedInError(err: unknown): boolean {
  const msg = String(
    err instanceof Error ? err.message : err || ""
  ).toLowerCase();
  return msg.includes("already checked in") || msg.includes("too_soon");
}

/** Legacy alias — Solana session comes from wallet connect / check-in token. */
export async function refreshSessionFromCheckIn(
  _walletAddress: string,
  _campaignId?: number
): Promise<void> {
  // no-op on Solana
}
