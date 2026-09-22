import { SparkSnapshot, StoredSparkState } from "@/types";
import {
  applySparkSpend,
  coerceSparkState,
  computeSparkSnapshot,
  defaultSparkState,
  normalizeSparkState,
} from "@/lib/spark";
import {
  readGuestSparkStateJson,
  writeGuestSparkStateJson,
} from "@/lib/player-id";
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

/** Guest Sparks: full bar by default, persisted in localStorage (no API). */
export function loadGuestSparkData(): SparkApiResponse {
  const raw = readGuestSparkStateJson();
  if (!raw) {
    const fresh = localSparkData();
    writeGuestSparkStateJson(JSON.stringify(fresh.state));
    return fresh;
  }
  try {
    const state = normalizeSparkState(coerceSparkState(JSON.parse(raw)));
    writeGuestSparkStateJson(JSON.stringify(state));
    return { state, sparks: computeSparkSnapshot(state) };
  } catch {
    const fresh = localSparkData();
    writeGuestSparkStateJson(JSON.stringify(fresh.state));
    return fresh;
  }
}

export function spendGuestSpark(): SparkSpendResponse {
  const current = loadGuestSparkData().state;
  const next = applySparkSpend(current);
  if (!next) {
    throw new Error("No Sparks available. Wait for a refill or try again later.");
  }
  writeGuestSparkStateJson(JSON.stringify(next));
  return {
    state: next,
    sparks: computeSparkSnapshot(next),
    spent: true,
  };
}

/** Extend local Infinite Spark by 24h (shuffle / streak prize). */
export function grantGuestInfiniteSpark(
  durationMs = 24 * 60 * 60 * 1000
): SparkApiResponse {
  const now = Date.now();
  const current = normalizeSparkState(loadGuestSparkData().state, now);
  const baseUntil =
    current.infiniteUntil && current.infiniteUntil > now
      ? current.infiniteUntil
      : now;
  const next = {
    ...current,
    infiniteUntil: baseUntil + durationMs,
  };
  writeGuestSparkStateJson(JSON.stringify(next));
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event("arcadex-sparks-changed"));
  }
  return { state: next, sparks: computeSparkSnapshot(next) };
}

export async function spendSpark(
  walletAddress: string
): Promise<SparkSpendResponse> {
  const res = await fetch("/api/sparks/spend", {
    method: "POST",
    headers: walletAuthHeaders(),
    body: JSON.stringify({ walletAddress }),
    cache: "no-store",
  });

  const data = (await res.json().catch(() => ({}))) as SparkSpendResponse & {
    error?: string;
  };

  if (!res.ok) {
    throw new Error(data.error ?? "Could not spend Spark.");
  }

  return data;
}
