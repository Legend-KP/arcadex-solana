import {
  decodeEventLog,
  getAddress,
  type Address,
  type Hash,
  type Hex,
} from "viem";
import {
  ARCADEX_REWARDS_ABI,
  ARCADEX_REWARDS_CONTRACT_ADDRESS,
  DEFAULT_STREAK_CAMPAIGN_ID,
  INFINITE_SPARK_REWARD_META,
  REWARD_OFFCHAIN,
  isArcadeXRewardsConfigured,
} from "@/lib/arcadex-rewards";
import {
  getCeloPublicClient,
  waitForCeloTransactionReceipt,
} from "@/lib/celo-public-client";

export interface VerifiedCheckIn {
  player: Address;
  campaignId: bigint;
  day: number;
  timestamp: bigint;
  milestone: VerifiedMilestone | null;
}

export interface VerifiedMilestone {
  player: Address;
  campaignId: bigint;
  day: number;
  rewardMode: number;
  rewardMeta: Hex;
  timestamp: bigint;
}

function assertConfigured(): void {
  if (!isArcadeXRewardsConfigured()) {
    throw new Error("ArcadeXRewards contract address is not configured.");
  }
}

export async function verifyCheckInTx(
  walletAddress: string,
  txHash: Hash,
  expectedCampaignId: number = DEFAULT_STREAK_CAMPAIGN_ID
): Promise<VerifiedCheckIn> {
  assertConfigured();
  const expectedPlayer = getAddress(walletAddress);
  const receipt = await waitForCeloTransactionReceipt(txHash, {
    timeoutMs: 20_000,
  });

  if (receipt.status !== "success") {
    throw new Error("Check-in transaction did not succeed.");
  }

  if (
    receipt.to?.toLowerCase() !==
    ARCADEX_REWARDS_CONTRACT_ADDRESS.toLowerCase()
  ) {
    throw new Error("Transaction was not sent to ArcadeXRewards.");
  }

  let checkIn: VerifiedCheckIn | null = null;
  let milestone: VerifiedMilestone | null = null;

  for (const log of receipt.logs) {
    if (
      log.address.toLowerCase() !==
      ARCADEX_REWARDS_CONTRACT_ADDRESS.toLowerCase()
    ) {
      continue;
    }

    try {
      const decoded = decodeEventLog({
        abi: ARCADEX_REWARDS_ABI,
        data: log.data,
        topics: log.topics,
      });

      if (decoded.eventName === "CheckedIn") {
        const { player, campaignId, day, timestamp } = decoded.args as {
          player: Address;
          campaignId: bigint;
          day: number;
          timestamp: bigint;
        };

        if (getAddress(player) !== expectedPlayer) {
          throw new Error("Check-in wallet does not match your account.");
        }
        if (Number(campaignId) !== expectedCampaignId) {
          throw new Error("Check-in is for a different campaign.");
        }

        checkIn = {
          player: getAddress(player),
          campaignId,
          day: Number(day),
          timestamp,
          milestone: null,
        };
      }

      if (decoded.eventName === "MilestoneReached") {
        const args = decoded.args as {
          player: Address;
          campaignId: bigint;
          day: number;
          rewardMode: number;
          rewardMeta: Hex;
          timestamp: bigint;
        };

        if (getAddress(args.player) !== expectedPlayer) {
          throw new Error("Milestone wallet does not match your account.");
        }
        if (Number(args.campaignId) !== expectedCampaignId) {
          throw new Error("Milestone is for a different campaign.");
        }

        milestone = {
          player: getAddress(args.player),
          campaignId: args.campaignId,
          day: Number(args.day),
          rewardMode: Number(args.rewardMode),
          rewardMeta: args.rewardMeta,
          timestamp: args.timestamp,
        };
      }
    } catch (err) {
      if (
        err instanceof Error &&
        (err.message.includes("does not match") ||
          err.message.includes("different campaign"))
      ) {
        throw err;
      }
      // Skip unrelated / undecodable logs
    }
  }

  if (!checkIn) {
    throw new Error("No CheckedIn event found in this transaction.");
  }

  checkIn.milestone = milestone;
  return checkIn;
}

export async function verifyOffchainMilestoneTx(
  walletAddress: string,
  txHash: Hash,
  expectedCampaignId: number = DEFAULT_STREAK_CAMPAIGN_ID
): Promise<VerifiedMilestone> {
  const checkIn = await verifyCheckInTx(
    walletAddress,
    txHash,
    expectedCampaignId
  );

  if (!checkIn.milestone) {
    throw new Error("This check-in did not complete the streak milestone.");
  }

  if (checkIn.milestone.rewardMode !== REWARD_OFFCHAIN) {
    throw new Error("This campaign is not an off-chain reward campaign.");
  }

  if (
    checkIn.milestone.rewardMeta.toLowerCase() !==
    INFINITE_SPARK_REWARD_META.toLowerCase()
  ) {
    throw new Error("Unexpected reward metadata for Infinite Spark grant.");
  }

  return checkIn.milestone;
}

export async function readStreakProgress(
  walletAddress: string,
  campaignId: number = DEFAULT_STREAK_CAMPAIGN_ID
) {
  assertConfigured();
  const player = getAddress(walletAddress);
  const publicClient = getCeloPublicClient();

  const [progress, campaign] = await Promise.all([
    publicClient.readContract({
      address: ARCADEX_REWARDS_CONTRACT_ADDRESS,
      abi: ARCADEX_REWARDS_ABI,
      functionName: "getProgress",
      args: [player, BigInt(campaignId)],
    }),
    publicClient.readContract({
      address: ARCADEX_REWARDS_CONTRACT_ADDRESS,
      abi: ARCADEX_REWARDS_ABI,
      functionName: "getCampaign",
      args: [BigInt(campaignId)],
    }),
  ]);

  const [
    currentDay,
    lastCheckInAt,
    milestoneReached,
    onChainClaimed,
    initialized,
    canCheckIn,
    streakWouldReset,
  ] = progress;

  const [
    active,
    cancelled,
    requireEligibility,
    campaignType,
    requiredDays,
    minIntervalSeconds,
    maxClaims,
    startTime,
    endTime,
    rewardMode,
    rewardTarget,
    rewardAmount,
    rewardMeta,
    resetAfterMilestone,
    maxSinglePayout,
  ] = campaign;

  return {
    campaignId,
    currentDay: Number(currentDay),
    lastCheckInAt: Number(lastCheckInAt),
    milestoneReached,
    onChainClaimed,
    initialized,
    canCheckIn,
    streakWouldReset,
    campaign: {
      active,
      cancelled,
      requireEligibility,
      campaignType: Number(campaignType),
      requiredDays: Number(requiredDays),
      minIntervalSeconds: Number(minIntervalSeconds),
      maxClaims: Number(maxClaims),
      startTime: Number(startTime),
      endTime: Number(endTime),
      rewardMode: Number(rewardMode),
      rewardTarget: rewardTarget as Address,
      rewardAmount: rewardAmount.toString(),
      rewardMeta: rewardMeta as Hex,
      resetAfterMilestone,
      maxSinglePayout: maxSinglePayout.toString(),
    },
  };
}

export interface VerifiedSpin {
  player: Address;
  campaignId: bigint;
  rewardMode: number;
  rewardTarget: Address;
  rewardAmount: bigint;
  timestamp: bigint;
}

export async function verifySpinTx(
  walletAddress: string,
  txHash: Hash,
  expectedCampaignId: number
): Promise<VerifiedSpin> {
  assertConfigured();
  const expectedPlayer = getAddress(walletAddress);
  const receipt = await waitForCeloTransactionReceipt(txHash, {
    timeoutMs: 20_000,
  });

  if (receipt.status !== "success") {
    throw new Error("Spin transaction did not succeed.");
  }

  if (
    receipt.to?.toLowerCase() !==
    ARCADEX_REWARDS_CONTRACT_ADDRESS.toLowerCase()
  ) {
    throw new Error("Transaction was not sent to ArcadeXRewards.");
  }

  let spin: VerifiedSpin | null = null;

  for (const log of receipt.logs) {
    if (
      log.address.toLowerCase() !==
      ARCADEX_REWARDS_CONTRACT_ADDRESS.toLowerCase()
    ) {
      continue;
    }

    try {
      const decoded = decodeEventLog({
        abi: ARCADEX_REWARDS_ABI,
        data: log.data,
        topics: log.topics,
      });

      if (decoded.eventName !== "SpinResultGranted") continue;

      const args = decoded.args as {
        player: Address;
        campaignId: bigint;
        rewardMode: number;
        rewardTarget: Address;
        rewardAmount: bigint;
        timestamp: bigint;
      };

      if (getAddress(args.player) !== expectedPlayer) {
        throw new Error("Spin wallet does not match your account.");
      }
      if (Number(args.campaignId) !== expectedCampaignId) {
        throw new Error("Spin is for a different campaign.");
      }

      spin = {
        player: getAddress(args.player),
        campaignId: args.campaignId,
        rewardMode: Number(args.rewardMode),
        rewardTarget: getAddress(args.rewardTarget),
        rewardAmount: args.rewardAmount,
        timestamp: args.timestamp,
      };
    } catch (err) {
      if (
        err instanceof Error &&
        (err.message.includes("does not match") ||
          err.message.includes("different campaign"))
      ) {
        throw err;
      }
    }
  }

  if (!spin) {
    throw new Error("No SpinResultGranted event found in this transaction.");
  }

  return spin;
}

export async function readSpinNonce(
  walletAddress: string,
  campaignId: number
): Promise<bigint> {
  assertConfigured();
  const player = getAddress(walletAddress);
  const publicClient = getCeloPublicClient();
  return publicClient.readContract({
    address: ARCADEX_REWARDS_CONTRACT_ADDRESS,
    abi: ARCADEX_REWARDS_ABI,
    functionName: "spinNonce",
    args: [player, BigInt(campaignId)],
  });
}
