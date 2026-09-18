/**
 * Build mainnet SPL fee transfers for ArcadeX (native MWA sign & send).
 * All RPC + assembly happens BEFORE opening the wallet session.
 */

import {
  Connection,
  PublicKey,
  Transaction,
  TransactionInstruction,
  LAMPORTS_PER_SOL,
} from "@solana/web3.js";
import {
  createAssociatedTokenAccountIdempotentInstruction,
  createTransferCheckedInstruction,
  getAssociatedTokenAddressSync,
  unpackAccount,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import { Buffer } from "buffer";
import {
  SOLANA_FEE_ATOMS,
  SOLANA_STABLE_DECIMALS,
  SOLANA_TREASURY,
  getSolanaRpcUrl,
  solanaMemoForPurpose,
  solanaMintForToken,
} from "./solana-pay-config";

const MEMO_PROGRAM_ID = new PublicKey(
  "MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr"
);

/** ~rent for one ATA + a few tx fees */
const MIN_SOL_LAMPORTS = Math.floor(0.004 * LAMPORTS_PER_SOL);

export function getConnection() {
  return new Connection(getSolanaRpcUrl(), {
    commitment: "confirmed",
    confirmTransactionInitialTimeout: 60_000,
  });
}

async function withRpcTimeout(promise, label, ms = 20_000) {
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(() => {
          reject(
            new Error(
              `RPC timeout (${label}). Set EXPO_PUBLIC_SOLANA_RPC_URL to a private RPC (Helius/QuickNode).`
            )
          );
        }, ms);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * Slow RPC validation — call BEFORE `transact()`.
 * @param {{ payerBase58: string, purpose: string, token: string }} opts
 */
export async function prepareArcadePay(opts) {
  const purpose = opts.purpose;
  const token = opts.token;
  if (!SOLANA_FEE_ATOMS[purpose]) {
    throw new Error(`Unsupported payment purpose: ${purpose}`);
  }

  const connection = getConnection();
  const payer = new PublicKey(opts.payerBase58);
  const treasury = new PublicKey(SOLANA_TREASURY);
  const mint = new PublicKey(solanaMintForToken(token));
  const amount = BigInt(SOLANA_FEE_ATOMS[purpose]);

  const sourceAta = getAssociatedTokenAddressSync(mint, payer);
  const destAta = getAssociatedTokenAddressSync(mint, treasury);

  const [sourceInfo, destInfo, solLamports] = await withRpcTimeout(
    Promise.all([
      connection.getAccountInfo(sourceAta),
      connection.getAccountInfo(destAta),
      connection.getBalance(payer),
    ]),
    "prepare"
  );

  if (!sourceInfo) {
    throw new Error(
      `No ${token} token account in wallet ${opts.payerBase58.slice(0, 4)}…${opts.payerBase58.slice(-4)}. Fund USDC/USDT on Solana mainnet first.`
    );
  }

  const have = unpackAccount(sourceAta, sourceInfo).amount; // bigint
  if (have < amount) {
    const fmt = (n) => (Number(n) / 10 ** SOLANA_STABLE_DECIMALS).toFixed(2);
    throw new Error(
      `Insufficient ${token}. Wallet ${opts.payerBase58.slice(0, 4)}…${opts.payerBase58.slice(-4)} has $${fmt(have)}, needs $${fmt(amount)}.`
    );
  }

  const needAtaCreate = !destInfo;
  if (needAtaCreate && solLamports < MIN_SOL_LAMPORTS) {
    throw new Error(
      "Not enough SOL. Need ~0.005 SOL for network fees and to create the treasury token account."
    );
  }
  if (!needAtaCreate && solLamports < 50_000) {
    throw new Error(
      "Not enough SOL for the network fee. Keep ~0.002 SOL in this wallet."
    );
  }

  return {
    payerBase58: opts.payerBase58,
    purpose,
    token,
    mintBase58: mint.toBase58(),
    sourceAtaBase58: sourceAta.toBase58(),
    destAtaBase58: destAta.toBase58(),
    treasuryBase58: treasury.toBase58(),
    amount: Number(amount),
    memo: solanaMemoForPurpose(purpose),
    needAtaCreate,
    tokenProgramIdBase58: TOKEN_PROGRAM_ID.toBase58(),
  };
}

/**
 * Assemble a ready-to-sign Transaction (no RPC).
 * @param {object} prepared from prepareArcadePay
 * @param {string} blockhash
 * @param {number} lastValidBlockHeight
 */
export function assembleArcadePayTx(prepared, blockhash, lastValidBlockHeight) {
  const payer = new PublicKey(prepared.payerBase58);
  const mint = new PublicKey(prepared.mintBase58);
  const sourceAta = new PublicKey(prepared.sourceAtaBase58);
  const destAta = new PublicKey(prepared.destAtaBase58);
  const treasury = new PublicKey(prepared.treasuryBase58);
  const amount = BigInt(prepared.amount);
  const tokenProgramId = prepared.tokenProgramIdBase58
    ? new PublicKey(prepared.tokenProgramIdBase58)
    : TOKEN_PROGRAM_ID;

  const tx = new Transaction();
  tx.feePayer = payer;
  tx.recentBlockhash = blockhash;
  tx.lastValidBlockHeight = lastValidBlockHeight;

  // Only add ATA create when needed (saves rent + avoids Phantom sim surprises).
  if (prepared.needAtaCreate) {
    tx.add(
      createAssociatedTokenAccountIdempotentInstruction(
        payer,
        destAta,
        treasury,
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
      payer,
      amount,
      SOLANA_STABLE_DECIMALS,
      [],
      tokenProgramId
    )
  );

  tx.add(
    new TransactionInstruction({
      keys: [{ pubkey: payer, isSigner: true, isWritable: false }],
      programId: MEMO_PROGRAM_ID,
      data: Buffer.from(prepared.memo, "utf8"),
    })
  );

  // Prove the tx can be serialized before opening Phantom.
  try {
    tx.serialize({ requireAllSignatures: false, verifySignatures: false });
  } catch (err) {
    throw new Error(
      `Could not build payment tx: ${err?.message || err}. Check Buffer polyfill / feePayer.`
    );
  }

  return tx;
}

export async function fetchFreshBlockhash() {
  const connection = getConnection();
  return withRpcTimeout(
    connection.getLatestBlockhash("confirmed"),
    "blockhash"
  );
}

/**
 * Full prepare + blockhash + assemble. Call entirely BEFORE `transact()`.
 * @param {{ payerBase58: string, purpose: string, token: string }} opts
 */
export async function buildArcadePayTx(opts) {
  console.warn("MWA_PAY", "build_start", getSolanaRpcUrl(), opts.purpose, opts.token);
  const prepared = await prepareArcadePay(opts);
  const { blockhash, lastValidBlockHeight } = await fetchFreshBlockhash();
  const transaction = assembleArcadePayTx(
    prepared,
    blockhash,
    lastValidBlockHeight
  );
  console.warn(
    "MWA_PAY",
    "build_ok",
    prepared.needAtaCreate ? "ata_create" : "ata_exists",
    blockhash.slice(0, 8)
  );
  return { prepared, transaction, blockhash, lastValidBlockHeight };
}

/** Broadcast a signed tx (after wallet.signTransactions). */
export async function sendSignedArcadePayTx(signedTx) {
  const connection = getConnection();
  const raw =
    typeof signedTx.serialize === "function"
      ? signedTx.serialize()
      : signedTx;
  return withRpcTimeout(
    connection.sendRawTransaction(raw, {
      skipPreflight: false,
      preflightCommitment: "confirmed",
    }),
    "broadcast"
  );
}
