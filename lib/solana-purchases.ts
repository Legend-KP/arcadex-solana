import type { SolanaPaymentToken } from "@/lib/solana-config";
import { getCachedSolanaAddress } from "@/lib/solana-address";
import { requestMwaPay } from "@/lib/arcadex-native-bridge";
import { INFINITE_SPARK_DURATION_MS } from "@/lib/infinite-spark";
import {
  computeSparkSnapshot,
  normalizeSparkState,
} from "@/lib/spark";
import { loadGuestSparkData, type SparkApiResponse } from "@/lib/spark-client";
import { writeGuestSparkStateJson } from "@/lib/player-id";
import type { StoredSparkState } from "@/types";
import type { SolanaPayPurpose } from "@/lib/solana-config";

async function confirmSolanaPayment(opts: {
  signature: string;
  walletAddress: string;
  purpose: SolanaPayPurpose;
}): Promise<void> {
  let lastError = "Payment not confirmed yet.";
  for (let i = 0; i < 6; i++) {
    if (i > 0) await new Promise((r) => setTimeout(r, 1500 * i));
    const res = await fetch("/api/solana/payments/confirm", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(opts),
      cache: "no-store",
    });
    const data = (await res.json().catch(() => ({}))) as {
      error?: string;
      code?: string;
      ok?: boolean;
    };
    if (res.ok && data.ok) return;
    lastError = data.error || lastError;
    if (data.code && data.code !== "NOT_CONFIRMED") {
      throw new Error(data.error || lastError);
    }
  }
  throw new Error(lastError);
}

function applyLocalRefill(state: StoredSparkState): StoredSparkState {
  const normalized = normalizeSparkState(state);
  return {
    ...normalized,
    slots: Array.from({ length: normalized.max }, () => null),
  };
}

function applyLocalInfinite(state: StoredSparkState): StoredSparkState {
  const now = Date.now();
  const normalized = normalizeSparkState(state, now);
  const baseUntil =
    normalized.infiniteUntil && normalized.infiniteUntil > now
      ? normalized.infiniteUntil
      : now;
  return {
    ...normalized,
    infiniteUntil: baseUntil + INFINITE_SPARK_DURATION_MS,
  };
}

function persistGuest(state: StoredSparkState): SparkApiResponse {
  writeGuestSparkStateJson(JSON.stringify(state));
  return { state, sparks: computeSparkSnapshot(state) };
}

export async function purchaseSparkRefillOnSolana(
  token: SolanaPaymentToken = "USDC"
): Promise<SparkApiResponse> {
  const wallet = getCachedSolanaAddress();
  if (!wallet) {
    throw new Error("Connect & sign in with your Solana wallet first.");
  }

  const paid = await requestMwaPay({ purpose: "spark_refill", token });
  await confirmSolanaPayment({
    signature: paid.signature,
    walletAddress: paid.address || wallet,
    purpose: "spark_refill",
  });

  return persistGuest(applyLocalRefill(loadGuestSparkData().state));
}

export async function purchaseInfiniteSparkOnSolana(
  token: SolanaPaymentToken = "USDC"
): Promise<SparkApiResponse> {
  const wallet = getCachedSolanaAddress();
  if (!wallet) {
    throw new Error("Connect & sign in with your Solana wallet first.");
  }

  const paid = await requestMwaPay({ purpose: "infinite_spark", token });
  await confirmSolanaPayment({
    signature: paid.signature,
    walletAddress: paid.address || wallet,
    purpose: "infinite_spark",
  });

  return persistGuest(applyLocalInfinite(loadGuestSparkData().state));
}

export async function purchaseScoreSubmitOnSolana(
  token: SolanaPaymentToken = "USDC"
): Promise<{ signature: string; address: string }> {
  const wallet = getCachedSolanaAddress();
  if (!wallet) {
    throw new Error("Connect & sign in with your Solana wallet first.");
  }

  const paid = await requestMwaPay({ purpose: "score_submit", token });
  await confirmSolanaPayment({
    signature: paid.signature,
    walletAddress: paid.address || wallet,
    purpose: "score_submit",
  });
  return { signature: paid.signature, address: paid.address || wallet };
}
