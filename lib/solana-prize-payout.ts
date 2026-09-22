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
  createAssociatedTokenAccountIdempotentInstruction,
  createTransferCheckedInstruction,
  getAssociatedTokenAddressSync,
  TOKEN_PROGRAM_ID,
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
  const sourceAta = getAssociatedTokenAddressSync(
    mint,
    payer.publicKey,
    false,
    TOKEN_PROGRAM_ID
  );
  const destAta = getAssociatedTokenAddressSync(
    mint,
    destOwner,
    false,
    TOKEN_PROGRAM_ID
  );
  const atoms = usdtToBaseUnits(opts.amount);

  const destInfo = await connection.getAccountInfo(destAta);
  const { blockhash, lastValidBlockHeight } =
    await connection.getLatestBlockhash("confirmed");

  const tx = new Transaction({
    feePayer: payer.publicKey,
    blockhash,
    lastValidBlockHeight,
  });

  if (!destInfo) {
    tx.add(
      createAssociatedTokenAccountIdempotentInstruction(
        payer.publicKey,
        destAta,
        destOwner,
        mint,
        TOKEN_PROGRAM_ID
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
      TOKEN_PROGRAM_ID
    )
  );

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
}
