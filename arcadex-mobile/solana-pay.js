/**
 * Build mainnet SPL fee transfers for ArcadeX (native MWA sign & send).
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
import {
  SOLANA_FEE_ATOMS,
  SOLANA_STABLE_DECIMALS,
  SOLANA_TREASURY,
  getSolanaRpcUrl,
  solanaMemoForPurpose,
  solanaMintForToken,
  type SolanaPayPurpose,
  type SolanaPaymentToken,
} from "./solana-pay-config";

const MEMO_PROGRAM_ID = new PublicKey(
  "MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr"
);

export async function buildArcadePayTransaction(opts: {
  payerBase58: string;
  purpose: SolanaPayPurpose;
  token: SolanaPaymentToken;
}) {
  const connection = new Connection(getSolanaRpcUrl(), "confirmed");
  const payer = new PublicKey(opts.payerBase58);
  const treasury = new PublicKey(SOLANA_TREASURY);
  const mint = new PublicKey(solanaMintForToken(opts.token));
  const amount = BigInt(SOLANA_FEE_ATOMS[opts.purpose]);

  const sourceAta = getAssociatedTokenAddressSync(mint, payer);
  const destAta = getAssociatedTokenAddressSync(mint, treasury);

  const sourceInfo = await connection.getAccountInfo(sourceAta);
  if (!sourceInfo) {
    throw new Error(
      `No ${opts.token} account found in this wallet. Add ${opts.token} on Solana mainnet first.`
    );
  }

  const ixes = [];

  // Ensure treasury ATA exists (user pays rent once if missing).
  ixes.push(
    createAssociatedTokenAccountIdempotentInstruction(
      payer,
      destAta,
      treasury,
      mint
    )
  );

  ixes.push(
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

  const memo = solanaMemoForPurpose(opts.purpose);
  ixes.push(
    new TransactionInstruction({
      keys: [{ pubkey: payer, isSigner: true, isWritable: false }],
      programId: MEMO_PROGRAM_ID,
      data: Buffer.from(memo, "utf8"),
    })
  );

  const { blockhash, lastValidBlockHeight } =
    await connection.getLatestBlockhash("confirmed");

  const tx = new Transaction({
    feePayer: payer,
    blockhash,
    lastValidBlockHeight,
  });
  tx.add(...ixes);
  return { transaction: tx, amount: Number(amount), memo };
}
