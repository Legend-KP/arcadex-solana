import {
  type Address,
  type Hex,
  hashTypedData,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { celo } from "viem/chains";
import { ARCADEX_REWARDS_CONTRACT_ADDRESS } from "@/lib/arcadex-rewards";

const SPIN_TYPES = {
  Spin: [
    { name: "player", type: "address" },
    { name: "campaignId", type: "uint256" },
    { name: "rewardMode", type: "uint8" },
    { name: "rewardTarget", type: "address" },
    { name: "rewardAmount", type: "uint256" },
    { name: "nonce", type: "uint256" },
    { name: "deadline", type: "uint256" },
  ],
} as const;

function getSpinSignerPrivateKey(): Hex {
  const raw =
    process.env.SPIN_RESULT_PRIVATE_KEY?.trim() ||
    process.env.PRIVATE_KEY?.trim() ||
    "";
  if (!raw) {
    throw new Error(
      "SPIN_RESULT_PRIVATE_KEY (or PRIVATE_KEY for test) is not configured."
    );
  }
  const normalized = raw.startsWith("0x") ? raw : `0x${raw}`;
  if (!/^0x[0-9a-fA-F]{64}$/.test(normalized)) {
    throw new Error("SPIN_RESULT_PRIVATE_KEY is not a valid private key.");
  }
  return normalized as Hex;
}

export function getSpinSignerAddress(): Address {
  return privateKeyToAccount(getSpinSignerPrivateKey()).address;
}

export async function signShuffleSpin(params: {
  player: Address;
  campaignId: number;
  rewardMode: number;
  rewardTarget: Address;
  rewardAmount: bigint;
  nonce: bigint;
  deadline: bigint;
}): Promise<Hex> {
  const account = privateKeyToAccount(getSpinSignerPrivateKey());

  return account.signTypedData({
    domain: {
      name: "ArcadeXRewards",
      version: "1",
      chainId: celo.id,
      verifyingContract: ARCADEX_REWARDS_CONTRACT_ADDRESS,
    },
    types: SPIN_TYPES,
    primaryType: "Spin",
    message: {
      player: params.player,
      campaignId: BigInt(params.campaignId),
      rewardMode: params.rewardMode,
      rewardTarget: params.rewardTarget,
      rewardAmount: params.rewardAmount,
      nonce: params.nonce,
      deadline: params.deadline,
    },
  });
}

export function hashShuffleSpin(params: {
  player: Address;
  campaignId: number;
  rewardMode: number;
  rewardTarget: Address;
  rewardAmount: bigint;
  nonce: bigint;
  deadline: bigint;
}): Hex {
  return hashTypedData({
    domain: {
      name: "ArcadeXRewards",
      version: "1",
      chainId: celo.id,
      verifyingContract: ARCADEX_REWARDS_CONTRACT_ADDRESS,
    },
    types: SPIN_TYPES,
    primaryType: "Spin",
    message: {
      player: params.player,
      campaignId: BigInt(params.campaignId),
      rewardMode: params.rewardMode,
      rewardTarget: params.rewardTarget,
      rewardAmount: params.rewardAmount,
      nonce: params.nonce,
      deadline: params.deadline,
    },
  });
}
