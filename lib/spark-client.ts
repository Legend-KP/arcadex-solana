import { SparkSnapshot, StoredSparkState } from "@/types";
import { defaultSparkState, computeSparkSnapshot } from "@/lib/spark";
import {
  refreshSessionFromCheckIn,
  SessionRefreshError,
} from "@/lib/streak-client";
import { isArcadeXRewardsConfigured } from "@/lib/arcadex-rewards";
import { walletAuthHeaders } from "@/lib/wallet-session-client";

export interface SparkApiResponse {
  state: StoredSparkState;
  sparks: SparkSnapshot;
}

export async function fetchSparkData(
  walletAddress: string
): Promise<SparkApiResponse> {
  const res = await fetch(
    `/api/sparks?walletAddress=${encodeURIComponent(walletAddress)}`,
    { cache: "no-store", headers: walletAuthHeaders() }
  );

  if (!res.ok) {
    const data = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(data.error ?? "Could not load Sparks.");
  }

  return (await res.json()) as SparkApiResponse;
}

export function localSparkData(): SparkApiResponse {
  const state = defaultSparkState();
  return { state, sparks: computeSparkSnapshot(state) };
}

export interface SparkSpendResponse extends SparkApiResponse {
  spent: boolean;
}

async function spendSparkOnce(
  walletAddress: string
): Promise<{ ok: true; data: SparkSpendResponse } | { ok: false; error: string; status: number; code?: string }> {
  const res = await fetch("/api/sparks/spend", {
    method: "POST",
    headers: walletAuthHeaders(),
    body: JSON.stringify({ walletAddress }),
    cache: "no-store",
  });

  const data = (await res.json().catch(() => ({}))) as SparkSpendResponse & {
    error?: string;
    code?: string;
  };

  if (!res.ok) {
    return {
      ok: false,
      error: data.error ?? "Could not spend Spark.",
      status: res.status,
      code: data.code,
    };
  }

  return { ok: true, data };
}

export async function spendSpark(
  walletAddress: string
): Promise<SparkSpendResponse> {
  let result = await spendSparkOnce(walletAddress);

  if (
    !result.ok &&
    (result.status === 401 || result.code === "UNAUTHORIZED") &&
    isArcadeXRewardsConfigured()
  ) {
    try {
      await refreshSessionFromCheckIn(walletAddress);
      result = await spendSparkOnce(walletAddress);
    } catch (err) {
      if (err instanceof SessionRefreshError && err.code === "NEED_CHECKIN") {
        throw new Error("Daily check-in required. Please check in to continue.");
      }
      // Fall through to original spend error below
    }
  }

  if (!result.ok) {
    throw new Error(result.error);
  }

  return result.data;
}

export interface InfiniteSparkActivateResponse extends SparkApiResponse {
  activated: boolean;
}

export async function activateInfiniteSpark(
  walletAddress: string,
  txHash: string
): Promise<InfiniteSparkActivateResponse> {
  const res = await fetch("/api/sparks/infinite", {
    method: "POST",
    headers: walletAuthHeaders(),
    body: JSON.stringify({ walletAddress, txHash }),
    cache: "no-store",
  });

  const data = (await res.json().catch(() => ({}))) as InfiniteSparkActivateResponse & {
    error?: string;
    code?: string;
  };

  if (!res.ok) {
    throw new Error(data.error ?? "Could not activate Infinite Spark.");
  }

  return data;
}

export interface SparkRefillActivateResponse extends SparkApiResponse {
  refilled: boolean;
}

export async function activateSparkRefill(
  walletAddress: string,
  txHash: string
): Promise<SparkRefillActivateResponse> {
  const res = await fetch("/api/sparks/refill", {
    method: "POST",
    headers: walletAuthHeaders(),
    body: JSON.stringify({ walletAddress, txHash }),
    cache: "no-store",
  });

  const data = (await res.json().catch(() => ({}))) as SparkRefillActivateResponse & {
    error?: string;
    code?: string;
  };

  if (!res.ok) {
    throw new Error(data.error ?? "Could not activate Spark Refill.");
  }

  return data;
}
