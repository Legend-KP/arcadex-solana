import {
  INFINITE_SPARK_ABI,
  INFINITE_SPARK_CONTRACT_ADDRESS,
  type InfiniteSparkPaymentToken,
} from "@/lib/infinite-spark";
import { purchaseStablecoinFeeOnChain } from "@/lib/stablecoin-direct-pay";
import type { Hash } from "viem";

export async function purchaseInfiniteSparkOnChain(): Promise<{
  txHash: Hash;
  token: InfiniteSparkPaymentToken;
}> {
  return purchaseStablecoinFeeOnChain({
    contractAddress: INFINITE_SPARK_CONTRACT_ADDRESS,
    contractAbi: INFINITE_SPARK_ABI,
    connectError: "Connect your wallet in MiniPay to purchase Infinite Spark.",
    failError: "Infinite Spark payment failed.",
  });
}
