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

type TokenBalanceEntry = {
  accountIndex: number;
  mint: string;
  owner?: string;
  uiTokenAmount?: { amount?: string };
};

type ParsedTx = {
  slot?: number;
  meta?: {
    err: unknown;
    fee?: number;
    preTokenBalances?: TokenBalanceEntry[] | null;
    postTokenBalances?: TokenBalanceEntry[] | null;
  } | null;
  transaction?: {
    message?: {
      accountKeys?: Array<string | { pubkey: string }>;
      instructions?: Array<ParsedInstruction>;
    };
  };
};

type ParsedInstruction = {
  programId?: string;
  program?: string;
  // spl-memo: `parsed` is the memo text itself (plain string).
  // spl-token etc.: `parsed` is `{ type, info }`.
  parsed?:
    | string
    | {
        type?: string;
        info?: Record<string, unknown> | string;
      };
  // Unparsed instructions carry base58 data under `jsonParsed` encoding.
  data?: string;
};

const MEMO_PROGRAM_IDS = new Set([
  "MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr", // Memo v2
  "Memo1UhkJRfHyvLMcVucJwxXeuD728EqVDDwQDxFMNo", // Memo v1
]);

const BASE58_ALPHABET =
  "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

function base58ToUtf8(input: string): string | null {
  // Big-endian byte array, multiply-add one base58 digit at a time.
  const bytes: number[] = [];
  for (const ch of input) {
    let carry = BASE58_ALPHABET.indexOf(ch);
    if (carry < 0) return null;
    for (let i = bytes.length - 1; i >= 0; i--) {
      carry += bytes[i] * 58;
      bytes[i] = carry & 0xff;
      carry >>= 8;
    }
    while (carry > 0) {
      bytes.unshift(carry & 0xff);
      carry >>= 8;
    }
  }
  for (const ch of input) {
    if (ch !== "1") break;
    bytes.unshift(0);
  }
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(
      Uint8Array.from(bytes)
    );
  } catch {
    return null;
  }
}

function accountKey(entry: string | { pubkey: string } | undefined): string {
  if (!entry) return "";
  return typeof entry === "string" ? entry : entry.pubkey;
}

/**
 * Known treasury associated token accounts (ATA derivation needs ed25519
 * curve checks we don't want to ship server-side). Used as a fallback when the
 * RPC omits `owner` in token balance metadata.
 */
const KNOWN_TREASURY_TOKEN_ACCOUNTS: Record<string, Record<string, string>> = {
  BVn8YwTvXNQVn8az9UQFgM7X6eY6uF4MRyPf6hqfa9Tf: {
    EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v:
      "HVaARy56GNMUUqKS5ruGo3tLFHvn2pzKFrd1Ge8wNqJd", // USDC
    Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB:
      "E8aqTnddTtWRF4YJKvFnmeX4u3hdu3nbbqwbvaWNZkZi", // USDT
  },
};

/**
 * Token accounts in this tx that belong to the treasury, keyed by mint.
 * Primary source: `meta.postTokenBalances[].owner` (the treasury wallet itself
 * is usually NOT in accountKeys — only its ATA is). Fallback: known ATAs.
 */
function treasuryTokenAccounts(
  tx: ParsedTx,
  treasury: string
): Map<string, Set<string>> {
  const keys = (tx.transaction?.message?.accountKeys ?? []).map(accountKey);
  const byMint = new Map<string, Set<string>>();
  const add = (mint: string, account: string) => {
    if (!mint || !account) return;
    if (!byMint.has(mint)) byMint.set(mint, new Set());
    byMint.get(mint)!.add(account);
  };

  const balances = [
    ...(tx.meta?.postTokenBalances ?? []),
    ...(tx.meta?.preTokenBalances ?? []),
  ];
  for (const b of balances) {
    if (b.owner === treasury) add(b.mint, keys[b.accountIndex] ?? "");
  }
  for (const [mint, ata] of Object.entries(
    KNOWN_TREASURY_TOKEN_ACCOUNTS[treasury] ?? {}
  )) {
    add(mint, ata);
  }
  return byMint;
}

/** Net change of the treasury's balance for `mint`, from pre/post balances. */
function treasuryDelta(tx: ParsedTx, treasury: string, mint: string): number {
  const sum = (entries: TokenBalanceEntry[] | null | undefined) =>
    (entries ?? [])
      .filter((b) => b.owner === treasury && b.mint === mint)
      .reduce((acc, b) => acc + Number(b.uiTokenAmount?.amount ?? 0), 0);
  return sum(tx.meta?.postTokenBalances) - sum(tx.meta?.preTokenBalances);
}

function extractMemos(tx: ParsedTx): string[] {
  const ixs = tx.transaction?.message?.instructions ?? [];
  const memos: string[] = [];
  for (const ix of ixs) {
    const isMemoProgram =
      (ix.programId && MEMO_PROGRAM_IDS.has(ix.programId)) ||
      ix.program === "spl-memo";
    if (!isMemoProgram) continue;

    // Standard jsonParsed shape: parsed is the memo string.
    if (typeof ix.parsed === "string") {
      memos.push(ix.parsed);
      continue;
    }
    // Defensive: some providers wrap it.
    if (ix.parsed && typeof ix.parsed === "object") {
      const info = ix.parsed.info;
      if (typeof info === "string") memos.push(info);
      else if (info && typeof info === "object") {
        const memo = (info as { memo?: unknown }).memo;
        if (typeof memo === "string") memos.push(memo);
      }
      continue;
    }
    // Unparsed fallback: base58 bytes.
    if (typeof ix.data === "string") {
      const text = base58ToUtf8(ix.data);
      if (text) memos.push(text);
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
    if (!parsed || typeof parsed !== "object") continue;
    if (!parsed.info || typeof parsed.info !== "object") continue;
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
  const treasuryAccounts = treasuryTokenAccounts(tx, treasury);

  const isToTreasury = (t: TokenTransferHit) =>
    (t.destinationOwner && t.destinationOwner === treasury) ||
    (t.destination && treasuryAccounts.get(t.mint)?.has(t.destination)) ||
    false;

  // Primary: a top-level transferChecked/transfer of the exact fee into a
  // treasury token account for a supported mint.
  let resolved = transfers.find(
    (t) =>
      Boolean(solanaTokenForMint(t.mint)) &&
      t.amount === expectedAmount &&
      isToTreasury(t)
  );

  // Fallback: balance delta (covers CPI/inner-instruction transfers).
  let deltaMint: string | null = null;
  if (!resolved) {
    for (const mint of treasuryAccounts.keys()) {
      if (!solanaTokenForMint(mint)) continue;
      if (treasuryDelta(tx, treasury, mint) === expectedAmount) {
        deltaMint = mint;
        break;
      }
    }
  }

  if (!resolved && !deltaMint) {
    throw new SolanaPaymentVerifyError(
      `No ${opts.expectedPurpose} fee transfer of ${expectedAmount} to treasury found.`,
      "WRONG_AMOUNT"
    );
  }

  const mint = resolved?.mint ?? deltaMint!;
  const token = solanaTokenForMint(mint);
  if (!token) {
    throw new SolanaPaymentVerifyError("Unsupported mint.", "INVALID_TX");
  }
  if (!resolved) {
    resolved = { mint, amount: expectedAmount };
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
