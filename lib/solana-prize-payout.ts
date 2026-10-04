/**
 * Custodial Solana USDT prize payouts for Daily Shuffle.
 *
 * Env (Cloudflare Worker secrets / vars):
 * - SOLANA_PRIZE_WALLET_SECRET  base58 secret key OR JSON byte array [1,2,…]
 * - SOLANA_RPC_URL               private RPC recommended
 * - SHUFFLE_DAILY_USDT_BUDGET    human USDT/day (default 1)
 */

import {
  Connection,
  Keypair,
  PublicKey,
  Transaction,
  sendAndConfirmTransaction,
} from "@solana/web3.js";
import {
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  createAssociatedTokenAccountIdempotentInstruction,
  createTransferCheckedInstruction,
  getAssociatedTokenAddressSync,
  unpackAccount,
} from "@solana/spl-token";
import bs58 from "bs58";
import {
  getSolanaRpcUrl,
  SOLANA_STABLE_DECIMALS,
  SOLANA_USDT_MINT,
} from "@/lib/solana-config";
import { usdtToBaseUnits } from "@/lib/shuffle-outcomes";

function loadPrizeKeypair(): Keypair {
  const raw = process.env.SOLANA_PRIZE_WALLET_SECRET?.trim() || "";
  if (!raw) {
    throw new Error(
      "SOLANA_PRIZE_WALLET_SECRET is not configured. Set the prize wallet secret key."
    );
  }
  try {
    if (raw.startsWith("[")) {
      const arr = JSON.parse(raw) as number[];
      return Keypair.fromSecretKey(Uint8Array.from(arr));
    }
    return Keypair.fromSecretKey(bs58.decode(raw));
  } catch {
    throw new Error(
      "SOLANA_PRIZE_WALLET_SECRET is invalid (expect base58 or JSON byte array)."
    );
  }
}

export function isPrizeWalletConfigured(): boolean {
  return Boolean(process.env.SOLANA_PRIZE_WALLET_SECRET?.trim());
}

export function getPrizeWalletAddress(): string | null {
  if (!isPrizeWalletConfigured()) return null;
  try {
    return loadPrizeKeypair().publicKey.toBase58();
  } catch {
    return null;
  }
}

function resolveTokenProgramId(mintOwner: PublicKey): PublicKey {
  if (mintOwner.equals(TOKEN_2022_PROGRAM_ID)) return TOKEN_2022_PROGRAM_ID;
  if (mintOwner.equals(TOKEN_PROGRAM_ID)) return TOKEN_PROGRAM_ID;
  throw new Error(
    `USDT mint is owned by unexpected program ${mintOwner.toBase58()}.`
  );
}

/**
 * Send `amount` USDT (human units) from the prize wallet to `toWallet`.
 * Creates the destination ATA if needed (prize wallet pays rent).
 */
export async function sendPrizeUsdt(opts: {
  toWallet: string;
  amount: number;
}): Promise<{ signature: string; from: string; to: string; amount: number }> {
  if (!(opts.amount > 0)) {
    throw new Error("Prize amount must be positive.");
  }

  const payer = loadPrizeKeypair();
  const connection = new Connection(getSolanaRpcUrl(), {
    commitment: "confirmed",
    confirmTransactionInitialTimeout: 90_000,
  });
  const mint = new PublicKey(SOLANA_USDT_MINT);
  const destOwner = new PublicKey(opts.toWallet);
  const atoms = BigInt(usdtToBaseUnits(opts.amount));

  const mintInfo = await connection.getAccountInfo(mint, "confirmed");
  if (!mintInfo) {
    throw new Error("USDT mint account not found on Solana RPC.");
  }
  const tokenProgramId = resolveTokenProgramId(mintInfo.owner);

  const sourceAta = getAssociatedTokenAddressSync(
    mint,
    payer.publicKey,
    false,
    tokenProgramId
  );
  const destAta = getAssociatedTokenAddressSync(
    mint,
    destOwner,
    false,
    tokenProgramId
  );

  const [sourceInfo, destInfo, solLamports] = await Promise.all([
    connection.getAccountInfo(sourceAta, "confirmed"),
    connection.getAccountInfo(destAta, "confirmed"),
    connection.getBalance(payer.publicKey, "confirmed"),
  ]);

  if (!sourceInfo) {
    throw new Error(
      `Prize wallet has no USDT token account. Fund ${payer.publicKey.toBase58()} with USDT on mint ${SOLANA_USDT_MINT}.`
    );
  }
  if (!sourceInfo.owner.equals(tokenProgramId)) {
    throw new Error(
      "Prize wallet USDT account uses a different token program than the mint."
    );
  }

  let sourceAmount: bigint;
  try {
    sourceAmount = unpackAccount(sourceAta, sourceInfo, tokenProgramId).amount;
  } catch {
    throw new Error(
      "Prize wallet USDT account data is invalid. Recreate the prize ATA for USDT."
    );
  }

  if (sourceAmount < atoms) {
    const have = Number(sourceAmount) / 10 ** SOLANA_STABLE_DECIMALS;
    throw new Error(
      `Prize wallet USDT balance too low (has ${have}, needs ${opts.amount}).`
    );
  }

  const needAtaCreate =
    !destInfo || !destInfo.owner.equals(tokenProgramId);
  // ATA create (~0.002) + fee buffer
  const minSol = needAtaCreate ? 5_000_000 : 50_000;
  if (solLamports < minSol) {
    throw new Error(
      `Prize wallet needs more SOL for fees${
        needAtaCreate ? " and ATA rent" : ""
      } (has ${(solLamports / 1e9).toFixed(4)} SOL).`
    );
  }

  const { blockhash, lastValidBlockHeight } =
    await connection.getLatestBlockhash("confirmed");

  const tx = new Transaction({
    feePayer: payer.publicKey,
    blockhash,
    lastValidBlockHeight,
  });

  // Always idempotent-create when missing/invalid — avoids InvalidAccountData
  // when a stale non-token account sits at the ATA address.
  if (needAtaCreate) {
    tx.add(
      createAssociatedTokenAccountIdempotentInstruction(
        payer.publicKey,
        destAta,
        destOwner,
        mint,
        tokenProgramId
      )
    );
  }

  tx.add(
    createTransferCheckedInstruction(
      sourceAta,
      mint,
      destAta,
      payer.publicKey,
      atoms,
      SOLANA_STABLE_DECIMALS,
      [],
      tokenProgramId
    )
  );

  try {
    const signature = await sendAndConfirmTransaction(connection, tx, [payer], {
      commitment: "confirmed",
      maxRetries: 3,
    });

    return {
      signature,
      from: payer.publicKey.toBase58(),
      to: opts.toWallet,
      amount: opts.amount,
    };
  } catch (err) {
    const raw = err instanceof Error ? err.message : String(err);
    if (/invalid account data/i.test(raw)) {
      throw new Error(
        `USDT transfer failed (invalid token account). Check prize wallet USDT ATA for mint ${SOLANA_USDT_MINT}. ${raw}`
      );
    }
    throw err instanceof Error ? err : new Error(raw);
  }
}
