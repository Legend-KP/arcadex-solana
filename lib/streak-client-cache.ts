"use client";

import type { StreakStatus } from "@/lib/streak-client";

const STORAGE_KEY = "arcadex_streak_status_v2";

/** Client-side cache — skip /api/streak/status when still fresh. */
export const STREAK_CLIENT_CACHE_MS = 5 * 60 * 1000;

type CachedStreak = {
  wallet: string;
  campaignId: number;
  status: StreakStatus;
  fetchedAt: number;
};

function canUseStorage(): boolean {
  return typeof window !== "undefined" && typeof sessionStorage !== "undefined";
}

export function readCachedStreakStatus(
  wallet: string,
  campaignId?: number
): StreakStatus | null {
  if (!canUseStorage()) return null;

  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) {
      // Drop legacy v1 cache that ignored campaignId (blocked shuffle after streak).
      sessionStorage.removeItem("arcadex_streak_status_v1");
      return null;
    }

    const parsed = JSON.parse(raw) as CachedStreak;
    if (parsed.wallet.toLowerCase() !== wallet.toLowerCase()) return null;
    if (
      typeof campaignId === "number" &&
      Number(parsed.campaignId) !== Number(campaignId)
    ) {
      return null;
    }
    if (Date.now() - parsed.fetchedAt > STREAK_CLIENT_CACHE_MS) return null;

    return parsed.status;
  } catch {
    return null;
  }
}

export function writeCachedStreakStatus(
  wallet: string,
  status: StreakStatus
): void {
  if (!canUseStorage()) return;

  try {
    const payload: CachedStreak = {
      wallet: wallet.toLowerCase(),
      campaignId: Number(status.campaignId),
      status,
      fetchedAt: Date.now(),
    };
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
    sessionStorage.removeItem("arcadex_streak_status_v1");
  } catch {
    // Storage quota or private mode
  }
}

export function clearCachedStreakStatus(): void {
  if (!canUseStorage()) return;
  try {
    sessionStorage.removeItem(STORAGE_KEY);
    sessionStorage.removeItem("arcadex_streak_status_v1");
  } catch {
    // Ignore
  }
}

/** Use cache when user already checked in; always refetch when check-in is due. */
export function shouldUseCachedStreakStatus(status: StreakStatus): boolean {
  return !status.canCheckIn;
}
