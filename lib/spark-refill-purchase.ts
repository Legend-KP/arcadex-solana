import {
  SPARK_REFILL_ABI,
  SPARK_REFILL_CONTRACT_ADDRESS,
  type SparkRefillPaymentToken,
} from "@/lib/spark-refill";
import { purchaseStablecoinFeeOnChain } from "@/lib/stablecoin-direct-pay";
import type { Hash } from "viem";

export async function purchaseSparkRefillOnChain(): Promise<{
  txHash: Hash;
  token: SparkRefillPaymentToken;
}> {
  return purchaseStablecoinFeeOnChain({
    contractAddress: SPARK_REFILL_CONTRACT_ADDRESS,
    contractAbi: SPARK_REFILL_ABI,
    connectError: "Connect your wallet in MiniPay to purchase Spark Refill.",
    failError: "Spark Refill payment failed.",
  });
}
