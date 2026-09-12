import {
  SCORE_SUBMIT_ABI,
  SCORE_SUBMIT_CONTRACT_ADDRESS,
  type ScoreSubmitPaymentToken,
} from "@/lib/score-submit";
import { purchaseStablecoinFeeOnChain } from "@/lib/stablecoin-direct-pay";
import type { Hash } from "viem";

export async function purchaseScoreSubmitOnChain(): Promise<{
  txHash: Hash;
  token: ScoreSubmitPaymentToken;
}> {
  return purchaseStablecoinFeeOnChain({
    contractAddress: SCORE_SUBMIT_CONTRACT_ADDRESS,
    contractAbi: SCORE_SUBMIT_ABI,
    connectError: "Connect your wallet in MiniPay to submit your score.",
    failError: "Score submission payment failed.",
  });
}
