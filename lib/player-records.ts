/** Shared player-store record shapes (RTDB + D1). */

export type GameStateRecord = {
  found: boolean;
  revision: number;
  state: Record<string, unknown> | null;
};

export type ShufflePendingRecord = {
  wallet: string;
  campaignId: number;
  nonce: number;
  outcomeId: string;
  outcomeType: "usdt" | "spark" | "none";
  displayAmount: number | null;
  rewardMode: number;
  rewardTarget: string;
  rewardAmount: string;
  deadline: number;
  signature: string;
  createdAt: number;
  consumedAt?: number;
  txHash?: string;
  /** SHA-256 of HttpOnly device cookie. Never returned to clients. */
  deviceHash?: string;
};
