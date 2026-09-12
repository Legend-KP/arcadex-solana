import type { Address, Hash } from "viem";
import {
  CELO_USDC_ADDRESS,
  CELO_USDT_ADDRESS,
  INFINITE_SPARK_ABI,
  INFINITE_SPARK_CONTRACT_ADDRESS,
  type InfiniteSparkPaymentToken,
} from "@/lib/infinite-spark";
import { verifyEntryPaidPaymentTx } from "@/lib/payment-tx-verify";

export interface VerifiedInfiniteSparkPayment {
  player: Address;
  token: InfiniteSparkPaymentToken;
  amount: bigint;
}

export async function verifyInfiniteSparkPaymentTx(
  walletAddress: string,
  txHash: Hash
): Promise<VerifiedInfiniteSparkPayment> {
  return verifyEntryPaidPaymentTx({
    walletAddress,
    txHash,
    contractAddress: INFINITE_SPARK_CONTRACT_ADDRESS,
    abi: INFINITE_SPARK_ABI,
    usdtAddress: CELO_USDT_ADDRESS,
    usdcAddress: CELO_USDC_ADDRESS,
    contractLabel: "InfiniteSpark",
  });
}
