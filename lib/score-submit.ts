import type { Address } from "viem";
import {
  CELO_USDC_ADDRESS,
  CELO_USDC_FEE_CURRENCY,
  CELO_USDT_ADDRESS,
  CELO_USDT_FEE_CURRENCY,
  ERC20_ABI,
  SPARK_REFILL_ABI,
  STABLECOIN_DECIMALS,
} from "@/lib/spark-refill";

export const SCORE_SUBMIT_CONTRACT_ADDRESS =
  (process.env.NEXT_PUBLIC_SCORE_SUBMIT_CONTRACT ??
    "0x7EE96ddeabB9a7A93cd4A66A32aC45622028555F") as Address;

export type ScoreSubmitPaymentToken = "USDT" | "USDC";

export const SCORE_SUBMIT_ABI = SPARK_REFILL_ABI;

export {
  CELO_USDC_ADDRESS,
  CELO_USDC_FEE_CURRENCY,
  CELO_USDT_ADDRESS,
  CELO_USDT_FEE_CURRENCY,
  ERC20_ABI,
  STABLECOIN_DECIMALS,
};

export function tokenAddress(token: ScoreSubmitPaymentToken): Address {
  return token === "USDT" ? CELO_USDT_ADDRESS : CELO_USDC_ADDRESS;
}

export function tokenFeeCurrency(token: ScoreSubmitPaymentToken): Address {
  return token === "USDT" ? CELO_USDT_FEE_CURRENCY : CELO_USDC_FEE_CURRENCY;
}
