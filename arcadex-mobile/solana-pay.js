/**
 * Build mainnet SPL fee transfers for ArcadeX (native MWA sign & send).
 * All RPC + assembly happens BEFORE opening the wallet session.
 */

import {
  Connection,
  PublicKey,
  Transaction,
  TransactionInstruction,
} from "@solana/web3.js";
import {
  createAssociatedTokenAccountIdempotentInstruction,
  createTransferCheckedInstruction,
  getAssociatedTokenAddressSync,
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

export function getConnection() {
  return new Connection(getSolanaRpcUrl(), "confirmed");
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

  const sourceInfo = await connection.getAccountInfo(sourceAta);
  if (!sourceInfo) {
    throw new Error(
      `No ${token} token account in this wallet. Fund USDC/USDT on Solana mainnet first.`
    );
  }

  const balance = await connection.getTokenAccountBalance(sourceAta);
  const have = BigInt(balance?.value?.amount ?? "0");
  if (have < amount) {
    const need = Number(amount) / 10 ** SOLANA_STABLE_DECIMALS;
    throw new Error(
      `Insufficient ${token}. Need at least $${need.toFixed(2)} plus a little SOL for fees.`
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

  const tx = new Transaction({
    feePayer: payer,
    blockhash,
    lastValidBlockHeight,
  });

  // Idempotent ATA create — no-op if treasury ATA already exists.
  tx.add(
    createAssociatedTokenAccountIdempotentInstruction(
      payer, // payer of rent if ATA is created
      destAta,
      treasury,
      mint
    )
  );

  tx.add(
    createTransferCheckedInstruction(
      sourceAta,
      mint,
      destAta,
      payer,
      amount,
      SOLANA_STABLE_DECIMALS,
      [],
      TOKEN_PROGRAM_ID
    )
  );

  tx.add(
    new TransactionInstruction({
      keys: [{ pubkey: payer, isSigner: true, isWritable: false }],
      programId: MEMO_PROGRAM_ID,
      data: Buffer.from(prepared.memo, "utf8"),
    })
  );

  return tx;
}

export async function fetchFreshBlockhash() {
  const connection = getConnection();
  return connection.getLatestBlockhash("confirmed");
}

/**
 * Full prepare + blockhash + assemble. Call entirely BEFORE `transact()`.
 * @param {{ payerBase58: string, purpose: string, token: string }} opts
 */
export async function buildArcadePayTx(opts) {
  const prepared = await prepareArcadePay(opts);
  const { blockhash, lastValidBlockHeight } = await fetchFreshBlockhash();
  const transaction = assembleArcadePayTx(
    prepared,
    blockhash,
    lastValidBlockHeight
  );
  return { prepared, transaction, blockhash, lastValidBlockHeight };
}

/** Broadcast a signed tx (fallback when wallet signs but does not send). */
export async function sendSignedArcadePayTx(signedTx) {
  const connection = getConnection();
  const raw =
    typeof signedTx.serialize === "function"
      ? signedTx.serialize()
      : signedTx;
  return connection.sendRawTransaction(raw, {
    skipPreflight: false,
    preflightCommitment: "confirmed",
  });
}
