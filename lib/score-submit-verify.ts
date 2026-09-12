import type { Address, Hash } from "viem";
import {
  CELO_USDC_ADDRESS,
  CELO_USDT_ADDRESS,
  SCORE_SUBMIT_ABI,
  SCORE_SUBMIT_CONTRACT_ADDRESS,
  type ScoreSubmitPaymentToken,
} from "@/lib/score-submit";
import { verifyEntryPaidPaymentTx } from "@/lib/payment-tx-verify";

export interface VerifiedScoreSubmitPayment {
  player: Address;
  token: ScoreSubmitPaymentToken;
  amount: bigint;
}

export async function verifyScoreSubmitPaymentTx(
  walletAddress: string,
  txHash: Hash
): Promise<VerifiedScoreSubmitPayment> {
  return verifyEntryPaidPaymentTx({
    walletAddress,
    txHash,
    contractAddress: SCORE_SUBMIT_CONTRACT_ADDRESS,
    abi: SCORE_SUBMIT_ABI,
    usdtAddress: CELO_USDT_ADDRESS,
    usdcAddress: CELO_USDC_ADDRESS,
    contractLabel: "ScoreSubmit",
  });
}
