/**
 * Verify ArcadeX Solana fee payments via JSON-RPC (no heavy web3 bundle).
 * Expects: SPL Token transfer to treasury + memo `arcadex:<purpose>`.
 */

import {
  SOLANA_FEE_ATOMS,
  SOLANA_TREASURY,
  getSolanaRpcUrl,
  parseSolanaPayMemo,
  solanaTokenForMint,
  type SolanaPayPurpose,
  type SolanaPaymentToken,
} from "@/lib/solana-config";

export class SolanaPaymentVerifyError extends Error {
  constructor(
    message: string,
    public readonly code:
      | "INVALID_TX"
      | "WRONG_AMOUNT"
      | "WRONG_TREASURY"
      | "WRONG_PURPOSE"
      | "NOT_CONFIRMED" = "INVALID_TX"
  ) {
    super(message);
    this.name = "SolanaPaymentVerifyError";
  }
}

export interface VerifiedSolanaPayment {
  signature: string;
  payer: string;
  purpose: SolanaPayPurpose;
  token: SolanaPaymentToken;
  amount: number;
  mint: string;
}

async function rpc<T>(method: string, params: unknown[]): Promise<T> {
  const res = await fetch(getSolanaRpcUrl(), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    cache: "no-store",
  });
  if (!res.ok) {
    throw new SolanaPaymentVerifyError(
      `Solana RPC HTTP ${res.status}`,
      "NOT_CONFIRMED"
    );
  }
  const json = (await res.json()) as {
    result?: T;
    error?: { message?: string };
  };
  if (json.error) {
    throw new SolanaPaymentVerifyError(
      json.error.message || "Solana RPC error",
      "NOT_CONFIRMED"
    );
  }
  return json.result as T;
}

type ParsedTx = {
  slot?: number;
  meta?: {
    err: unknown;
    fee?: number;
  } | null;
  transaction?: {
    message?: {
      accountKeys?: Array<string | { pubkey: string }>;
      instructions?: Array<{
        programId?: string;
        parsed?: {
          type?: string;
          info?: Record<string, unknown>;
        };
        data?: string;
      }>;
    };
  };
};

function accountKey(entry: string | { pubkey: string } | undefined): string {
  if (!entry) return "";
  return typeof entry === "string" ? entry : entry.pubkey;
}

function extractMemos(tx: ParsedTx): string[] {
  const ixs = tx.transaction?.message?.instructions ?? [];
  const memos: string[] = [];
  for (const ix of ixs) {
    if (ix.programId === "MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr") {
      const parsed = ix.parsed as { type?: string; info?: string } | undefined;
      if (typeof parsed?.info === "string") memos.push(parsed.info);
      else if (typeof ix.data === "string") {
        try {
          memos.push(Buffer.from(ix.data, "base64").toString("utf8"));
        } catch {
          /* ignore */
        }
      }
    }
    // Some RPCs nest memo differently
    if (
      ix.parsed?.type === "memo" &&
      typeof (ix.parsed.info as { memo?: string } | undefined)?.memo === "string"
    ) {
      memos.push((ix.parsed.info as { memo: string }).memo);
    }
  }
  return memos;
}

interface TokenTransferHit {
  mint: string;
  amount: number;
  sourceOwner?: string;
  destinationOwner?: string;
  destination?: string;
}

function extractTokenTransfers(tx: ParsedTx): TokenTransferHit[] {
  const ixs = tx.transaction?.message?.instructions ?? [];
  const hits: TokenTransferHit[] = [];
  for (const ix of ixs) {
    const parsed = ix.parsed;
    if (!parsed?.info) continue;
    if (parsed.type !== "transfer" && parsed.type !== "transferChecked") {
      continue;
    }
    const info = parsed.info;
    const mint = String(info.mint ?? "");
    const amountRaw =
      info.tokenAmount &&
      typeof info.tokenAmount === "object" &&
      info.tokenAmount !== null &&
      "amount" in info.tokenAmount
        ? String((info.tokenAmount as { amount: string }).amount)
        : String(info.amount ?? "");
    const amount = Number(amountRaw);
    if (!Number.isFinite(amount)) continue;
    hits.push({
      mint,
      amount,
      sourceOwner: info.authority
        ? String(info.authority)
        : info.multisigAuthority
          ? String(info.multisigAuthority)
          : undefined,
      destinationOwner: info.destinationOwner
        ? String(info.destinationOwner)
        : undefined,
      destination: info.destination ? String(info.destination) : undefined,
    });
  }
  return hits;
}

export async function verifySolanaArcadePayment(opts: {
  signature: string;
  expectedPayer: string;
  expectedPurpose: SolanaPayPurpose;
}): Promise<VerifiedSolanaPayment> {
  const signature = opts.signature.trim();
  if (!/^[1-9A-HJ-NP-Za-km-z]{64,100}$/.test(signature)) {
    throw new SolanaPaymentVerifyError(
      "Invalid Solana transaction signature.",
      "INVALID_TX"
    );
  }

  const tx = await rpc<ParsedTx | null>("getTransaction", [
    signature,
    {
      encoding: "jsonParsed",
      commitment: "confirmed",
      maxSupportedTransactionVersion: 0,
    },
  ]);

  if (!tx) {
    throw new SolanaPaymentVerifyError(
      "Transaction not found yet. Wait a moment and retry.",
      "NOT_CONFIRMED"
    );
  }
  if (tx.meta?.err) {
    throw new SolanaPaymentVerifyError(
      "Transaction failed on-chain.",
      "INVALID_TX"
    );
  }

  const memos = extractMemos(tx);
  const purposeFromMemo = memos
    .map(parseSolanaPayMemo)
    .find((p): p is SolanaPayPurpose => Boolean(p));
  if (purposeFromMemo !== opts.expectedPurpose) {
    throw new SolanaPaymentVerifyError(
      `Missing or wrong payment memo (expected arcadex:${opts.expectedPurpose}).`,
      "WRONG_PURPOSE"
    );
  }

  const expectedAmount = SOLANA_FEE_ATOMS[opts.expectedPurpose];
  const transfers = extractTokenTransfers(tx);
  const treasury = SOLANA_TREASURY;
  const hit = transfers.find((t) => {
    const token = solanaTokenForMint(t.mint);
    if (!token) return false;
    if (t.amount !== expectedAmount) return false;
    // Prefer owner match; fall back to destination ATA string search via account keys later
    if (t.destinationOwner && t.destinationOwner === treasury) return true;
    return false;
  });

  // Fallback: any matching mint+amount where fee payer is expected payer
  // and treasury appears in account keys (ATA destination).
  let resolved = hit;
  if (!resolved) {
    const keys = (tx.transaction?.message?.accountKeys ?? []).map(accountKey);
    const treasuryInKeys = keys.includes(treasury);
    resolved = transfers.find((t) => {
      const token = solanaTokenForMint(t.mint);
      return (
        Boolean(token) &&
        t.amount === expectedAmount &&
        treasuryInKeys &&
        (!t.sourceOwner || t.sourceOwner === opts.expectedPayer)
      );
    });
  }

  if (!resolved) {
    throw new SolanaPaymentVerifyError(
      `No ${opts.expectedPurpose} fee transfer of ${expectedAmount} to treasury found.`,
      "WRONG_AMOUNT"
    );
  }

  const token = solanaTokenForMint(resolved.mint);
  if (!token) {
    throw new SolanaPaymentVerifyError("Unsupported mint.", "INVALID_TX");
  }

  const payer =
    resolved.sourceOwner ||
    accountKey(tx.transaction?.message?.accountKeys?.[0]);
  if (payer !== opts.expectedPayer) {
    throw new SolanaPaymentVerifyError(
      "Payment payer does not match connected wallet.",
      "INVALID_TX"
    );
  }

  return {
    signature,
    payer,
    purpose: opts.expectedPurpose,
    token,
    amount: resolved.amount,
    mint: resolved.mint,
  };
}
