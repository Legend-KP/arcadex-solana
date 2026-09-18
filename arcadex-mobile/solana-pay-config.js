/** Mirror of lib/solana-config.ts for the Expo native shell. */

export const SOLANA_TREASURY = "BVn8YwTvXNQVn8az9UQFgM7X6eY6uF4MRyPf6hqfa9Tf";
export const SOLANA_USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
export const SOLANA_USDT_MINT = "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB";
export const SOLANA_STABLE_DECIMALS = 6;

export const SOLANA_FEE_ATOMS = {
  spark_refill: 50_000,
  infinite_spark: 100_000,
  score_submit: 50_000,
};

export function solanaMintForToken(token) {
  return token === "USDT" ? SOLANA_USDT_MINT : SOLANA_USDC_MINT;
}

export function solanaMemoForPurpose(purpose) {
  return `arcadex:${purpose}`;
}

export function getSolanaRpcUrl() {
  return (
    (typeof process !== "undefined" &&
      process.env?.EXPO_PUBLIC_SOLANA_RPC_URL?.trim()) ||
    "https://api.mainnet-beta.solana.com"
  );
}
