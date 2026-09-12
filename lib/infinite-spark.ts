import type { Address } from "viem";

export const INFINITE_SPARK_DURATION_MS = 24 * 60 * 60 * 1000;

export const INFINITE_SPARK_CONTRACT_ADDRESS =
  (process.env.NEXT_PUBLIC_INFINITE_SPARK_CONTRACT ??
    "0x2a9f38b41035a900d5038D1972955011fb3278E7") as Address;

export {
  CELO_USDC_ADDRESS,
  CELO_USDC_FEE_CURRENCY,
  CELO_USDT_ADDRESS,
  CELO_USDT_FEE_CURRENCY,
  ERC20_ABI,
  SPARK_REFILL_ABI as INFINITE_SPARK_ABI,
  STABLECOIN_DECIMALS,
  tokenAddress,
  tokenFeeCurrency,
  type SparkRefillPaymentToken as InfiniteSparkPaymentToken,
} from "@/lib/spark-refill";
