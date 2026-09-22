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

/* ------------------------------------------------------------------------ */
/* Pending payments                                                          */
/*                                                                           */
/* Phantom can move the funds and the app can still fail afterwards (RPC     */
/* confirm, server verify, a crash). The signature is saved to localStorage  */
/* the moment the wallet returns it — BEFORE confirm — and only removed once */
/* the purchase has been credited locally. Anything left over is re-checked  */
/* on the next app load, so a paid player is never charged a second time.    */
/* ------------------------------------------------------------------------ */

const PENDING_KEY = "arcadex_solana_pending_payments";
const PENDING_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const PENDING_MAX_ATTEMPTS = 40;

export interface PendingSolanaPayment {
  signature: string;
  walletAddress: string;
  purpose: SolanaPayPurpose;
  token: SolanaPaymentToken;
  createdAt: number;
  attempts: number;
  lastError?: string;
}

function readPending(): PendingSolanaPayment[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(PENDING_KEY);
    const parsed = raw ? (JSON.parse(raw) as unknown) : [];
    return Array.isArray(parsed)
      ? parsed.filter(
          (p): p is PendingSolanaPayment =>
            Boolean(p) &&
            typeof (p as PendingSolanaPayment).signature === "string" &&
            typeof (p as PendingSolanaPayment).walletAddress === "string" &&
            typeof (p as PendingSolanaPayment).purpose === "string"
        )
      : [];
  } catch {
    return [];
  }
}

function writePending(list: PendingSolanaPayment[]): void {
  if (typeof window === "undefined") return;
  try {
    if (list.length === 0) localStorage.removeItem(PENDING_KEY);
    else localStorage.setItem(PENDING_KEY, JSON.stringify(list));
  } catch {
    /* storage full / disabled — nothing else we can do */
  }
}

function addPending(p: Omit<PendingSolanaPayment, "createdAt" | "attempts">) {
  const list = readPending().filter((x) => x.signature !== p.signature);
  list.push({ ...p, createdAt: Date.now(), attempts: 0 });
  writePending(list);
}

function removePending(signature: string): void {
  writePending(readPending().filter((x) => x.signature !== signature));
}

function notePendingAttempt(signature: string, error?: string): void {
  writePending(
    readPending().map((x) =>
      x.signature === signature
        ? { ...x, attempts: x.attempts + 1, lastError: error }
        : x
    )
  );
}

/** Pending payments for the currently connected wallet. */
export function getPendingSolanaPayments(
  walletAddress?: string | null
): PendingSolanaPayment[] {
  const wallet = walletAddress ?? getCachedSolanaAddress();
  if (!wallet) return [];
  return readPending().filter((p) => p.walletAddress === wallet);
}

/** Errors that mean "never going to succeed for this wallet". */
const UNRECOVERABLE_CODES = new Set(["TX_ALREADY_USED", "INVALID_PURPOSE"]);

class ConfirmError extends Error {
  constructor(
    message: string,
    public readonly code: string | undefined
  ) {
    super(message);
    this.name = "ConfirmError";
  }
}

async function confirmSolanaPayment(
  opts: {
    signature: string;
    walletAddress: string;
    purpose: SolanaPayPurpose;
  },
  maxAttempts = 6
): Promise<void> {
  let lastError = "Payment not confirmed yet.";
  let lastCode: string | undefined;
  for (let i = 0; i < maxAttempts; i++) {
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
    lastCode = data.code;
    if (data.code && data.code !== "NOT_CONFIRMED") {
      throw new ConfirmError(data.error || lastError, data.code);
    }
  }
  throw new ConfirmError(lastError, lastCode);
}

function applyLocalGrant(purpose: SolanaPayPurpose): SparkApiResponse | null {
  const current = loadGuestSparkData().state;
  if (purpose === "spark_refill") return persistGuest(applyLocalRefill(current));
  if (purpose === "infinite_spark") {
    return persistGuest(applyLocalInfinite(current));
  }
  return null; // score_submit is credited by the leaderboard endpoint
}

/**
 * Pay, confirm, credit. The signature is persisted before confirm so a
 * failure after Phantom has moved funds is recoverable, not a lost payment.
 */
async function payConfirmAndCredit(
  purpose: SolanaPayPurpose,
  token: SolanaPaymentToken
): Promise<{ signature: string; address: string; spark: SparkApiResponse | null }> {
  const wallet = getCachedSolanaAddress();
  if (!wallet) {
    throw new Error("Connect & sign in with your Solana wallet first.");
  }

  const paid = await requestMwaPay({ purpose, token, address: wallet });
  const address = paid.address || wallet;
  addPending({ signature: paid.signature, walletAddress: address, purpose, token });

  try {
    await confirmSolanaPayment({
      signature: paid.signature,
      walletAddress: address,
      purpose,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Payment not confirmed.";
    notePendingAttempt(paid.signature, msg);
    if (err instanceof ConfirmError && err.code && UNRECOVERABLE_CODES.has(err.code)) {
      removePending(paid.signature);
      throw err;
    }
    throw new Error(
      `${msg} Your payment is saved and will be re-checked automatically next time you open ArcadeX.`
    );
  }

  const spark = applyLocalGrant(purpose);
  removePending(paid.signature);
  return { signature: paid.signature, address, spark };
}

let recovering: Promise<SparkApiResponse | null> | null = null;

/**
 * Re-check payments that were paid but never credited. Call once on app load
 * (SparkProvider does this). Returns the latest spark state if anything was
 * credited, else null. Never throws.
 */
export function recoverPendingSolanaPayments(): Promise<SparkApiResponse | null> {
  if (recovering) return recovering;
  recovering = (async () => {
    const wallet = getCachedSolanaAddress();
    if (!wallet) return null;

    let latest: SparkApiResponse | null = null;
    const now = Date.now();

    for (const p of getPendingSolanaPayments(wallet)) {
      if (p.purpose === "score_submit") continue; // needs the score; handled by GameClient
      if (now - p.createdAt > PENDING_MAX_AGE_MS || p.attempts >= PENDING_MAX_ATTEMPTS) {
        removePending(p.signature);
        continue;
      }
      try {
        await confirmSolanaPayment(
          { signature: p.signature, walletAddress: p.walletAddress, purpose: p.purpose },
          2
        );
        latest = applyLocalGrant(p.purpose) ?? latest;
        removePending(p.signature);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (err instanceof ConfirmError && err.code && UNRECOVERABLE_CODES.has(err.code)) {
          removePending(p.signature);
        } else {
          notePendingAttempt(p.signature, msg);
        }
      }
    }
    return latest;
  })().finally(() => {
    recovering = null;
  });
  return recovering;
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
  const { spark } = await payConfirmAndCredit("spark_refill", token);
  return spark ?? persistGuest(applyLocalRefill(loadGuestSparkData().state));
}

export async function purchaseInfiniteSparkOnSolana(
  token: SolanaPaymentToken = "USDC"
): Promise<SparkApiResponse> {
  const { spark } = await payConfirmAndCredit("infinite_spark", token);
  return spark ?? persistGuest(applyLocalInfinite(loadGuestSparkData().state));
}

/** A score-submit payment that was made but whose confirm never succeeded. */
const SCORE_SUBMIT_REUSE_WINDOW_MS = 24 * 60 * 60 * 1000;

export async function purchaseScoreSubmitOnSolana(
  token: SolanaPaymentToken = "USDC"
): Promise<{ signature: string; address: string }> {
  const wallet = getCachedSolanaAddress();
  if (!wallet) {
    throw new Error("Connect & sign in with your Solana wallet first.");
  }

  // Reuse a recent paid-but-unconfirmed score_submit instead of charging again.
  const reusable = getPendingSolanaPayments(wallet).find(
    (p) =>
      p.purpose === "score_submit" &&
      Date.now() - p.createdAt < SCORE_SUBMIT_REUSE_WINDOW_MS
  );
  if (reusable) {
    try {
      await confirmSolanaPayment({
        signature: reusable.signature,
        walletAddress: reusable.walletAddress,
        purpose: "score_submit",
      });
      removePending(reusable.signature);
      return { signature: reusable.signature, address: reusable.walletAddress };
    } catch (err) {
      if (err instanceof ConfirmError && err.code && UNRECOVERABLE_CODES.has(err.code)) {
        removePending(reusable.signature);
      } else {
        notePendingAttempt(
          reusable.signature,
          err instanceof Error ? err.message : String(err)
        );
        throw new Error(
          `${err instanceof Error ? err.message : "Payment not confirmed."} Your earlier payment is saved — retry in a moment instead of paying again.`
        );
      }
    }
  }

  const { signature, address } = await payConfirmAndCredit("score_submit", token);
  return { signature, address };
}
