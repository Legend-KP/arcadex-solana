import type { Address, Hash } from "viem";
import {
  CELO_USDC_ADDRESS,
  CELO_USDT_ADDRESS,
  SPARK_REFILL_ABI,
  SPARK_REFILL_CONTRACT_ADDRESS,
  type SparkRefillPaymentToken,
} from "@/lib/spark-refill";
import { verifyEntryPaidPaymentTx } from "@/lib/payment-tx-verify";

export interface VerifiedSparkRefillPayment {
  player: Address;
  token: SparkRefillPaymentToken;
  amount: bigint;
}

export async function verifySparkRefillPaymentTx(
  walletAddress: string,
  txHash: Hash
): Promise<VerifiedSparkRefillPayment> {
  return verifyEntryPaidPaymentTx({
    walletAddress,
    txHash,
    contractAddress: SPARK_REFILL_CONTRACT_ADDRESS,
    abi: SPARK_REFILL_ABI,
    usdtAddress: CELO_USDT_ADDRESS,
    usdcAddress: CELO_USDC_ADDRESS,
    contractLabel: "SparkRefill",
  });
}
