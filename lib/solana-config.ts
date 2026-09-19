/**
 * Solana mainnet payment config for ArcadeX Seeker.
 * Fees use 6-decimal USDC/USDT ($0.05 / $0.10 / $0.05).
 */

export const SOLANA_CLUSTER = "mainnet-beta" as const;

export const SOLANA_TREASURY =
  process.env.NEXT_PUBLIC_SOLANA_TREASURY?.trim() ||
  "BVn8YwTvXNQVn8az9UQFgM7X6eY6uF4MRyPf6hqfa9Tf";

/** Mainnet USDC (Circle) */
export const SOLANA_USDC_MINT =
  process.env.NEXT_PUBLIC_SOLANA_USDC_MINT?.trim() ||
  "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";

/** Mainnet USDT (Tether) */
export const SOLANA_USDT_MINT =
  process.env.NEXT_PUBLIC_SOLANA_USDT_MINT?.trim() ||
  "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB";

export const SOLANA_STABLE_DECIMALS = 6;

export type SolanaPaymentToken = "USDC" | "USDT";

export type SolanaPayPurpose =
  | "spark_refill"
  | "infinite_spark"
  | "score_submit";

/** Atomic units (6 decimals): $0.05 / $0.10 / $0.05 */
export const SOLANA_FEE_ATOMS: Record<SolanaPayPurpose, number> = {
  spark_refill: 50_000,
  infinite_spark: 100_000,
  score_submit: 50_000,
};

export const SOLANA_FEE_USD: Record<SolanaPayPurpose, string> = {
  spark_refill: "0.05",
  infinite_spark: "0.10",
  score_submit: "0.05",
};

export function solanaMintForToken(token: SolanaPaymentToken): string {
  return token === "USDT" ? SOLANA_USDT_MINT : SOLANA_USDC_MINT;
}

export function solanaTokenForMint(mint: string): SolanaPaymentToken | null {
  if (mint === SOLANA_USDT_MINT) return "USDT";
  if (mint === SOLANA_USDC_MINT) return "USDC";
  return null;
}

export function solanaMemoForPurpose(purpose: SolanaPayPurpose): string {
  return `arcadex:${purpose}`;
}

export function parseSolanaPayMemo(
  memo: string
): SolanaPayPurpose | null {
  const m = memo.trim();
  if (m === "arcadex:spark_refill") return "spark_refill";
  if (m === "arcadex:infinite_spark") return "infinite_spark";
  if (m === "arcadex:score_submit") return "score_submit";
  return null;
}

export function getSolanaRpcUrl(): string {
  return (
    process.env.SOLANA_RPC_URL?.trim() ||
    process.env.NEXT_PUBLIC_SOLANA_RPC_URL?.trim() ||
    "https://api.mainnet-beta.solana.com"
  );
}
