import type { Address, Hash, Hex } from "viem";
import { keccak256, toBytes } from "viem";
import { celo } from "viem/chains";
import { waitForCeloTransactionReceipt } from "@/lib/celo-public-client";
import { createMiniPayWalletClient } from "@/lib/minipay";

/** ArcadeXTxHub on Celo mainnet — general free signIn + USDT/USDC pay purposes. */
export const ARCADEX_TX_HUB_CONTRACT_ADDRESS = (
  process.env.NEXT_PUBLIC_ARCADEX_TX_HUB_CONTRACT?.trim() ||
  "0x7D0fc71785B25d7878f83c4bf0E125DD89470FEc"
) as Address;

export const PLAY_PURPOSE = keccak256(toBytes("PLAY"));

export function purposeFromLabel(label: string): Hex {
  return keccak256(toBytes(label));
}

/** Per-game play purpose for Celoscan readability (still signIn). */
export function playPurpose(gameId: string): Hex {
  return keccak256(toBytes(`PLAY:${gameId}`));
}

export function isArcadeXTxHubConfigured(): boolean {
  return (
    Boolean(ARCADEX_TX_HUB_CONTRACT_ADDRESS) &&
    ARCADEX_TX_HUB_CONTRACT_ADDRESS.startsWith("0x") &&
    ARCADEX_TX_HUB_CONTRACT_ADDRESS.length === 42
  );
}

export const ARCADEX_TX_HUB_ABI = [
  { inputs: [], stateMutability: "nonpayable", type: "constructor" },
  { inputs: [], name: "AlreadyPaused", type: "error" },
  { inputs: [], name: "InvalidOwner", type: "error" },
  { inputs: [], name: "NoBalance", type: "error" },
  { inputs: [], name: "NoCelo", type: "error" },
  { inputs: [], name: "NotOwner", type: "error" },
  { inputs: [], name: "NotPaused", type: "error" },
  { inputs: [], name: "NotPendingOwner", type: "error" },
  { inputs: [], name: "PausedError", type: "error" },
  { inputs: [], name: "PurposeNotConfigured", type: "error" },
  { inputs: [], name: "Reentrancy", type: "error" },
  { inputs: [], name: "TransferAmountMismatch", type: "error" },
  { inputs: [], name: "TransferFailed", type: "error" },
  { inputs: [], name: "ZeroAddress", type: "error" },
  {
    anonymous: false,
    inputs: [
      { indexed: true, internalType: "address", name: "player", type: "address" },
      { indexed: true, internalType: "address", name: "token", type: "address" },
      { indexed: true, internalType: "bytes32", name: "purpose", type: "bytes32" },
      { indexed: false, internalType: "uint256", name: "amount", type: "uint256" },
      {
        indexed: false,
        internalType: "uint256",
        name: "timestamp",
        type: "uint256",
      },
    ],
    name: "EntryPaid",
    type: "event",
  },
  {
    anonymous: false,
    inputs: [
      { indexed: true, internalType: "bytes32", name: "purpose", type: "bytes32" },
      { indexed: false, internalType: "uint256", name: "oldFee", type: "uint256" },
      { indexed: false, internalType: "uint256", name: "newFee", type: "uint256" },
    ],
    name: "FeeUpdated",
    type: "event",
  },
  {
    anonymous: false,
    inputs: [
      {
        indexed: true,
        internalType: "address",
        name: "previousOwner",
        type: "address",
      },
      {
        indexed: true,
        internalType: "address",
        name: "pendingOwner",
        type: "address",
      },
    ],
    name: "OwnershipTransferStarted",
    type: "event",
  },
  {
    anonymous: false,
    inputs: [
      {
        indexed: true,
        internalType: "address",
        name: "previousOwner",
        type: "address",
      },
      {
        indexed: true,
        internalType: "address",
        name: "newOwner",
        type: "address",
      },
    ],
    name: "OwnershipTransferred",
    type: "event",
  },
  {
    anonymous: false,
    inputs: [
      { indexed: true, internalType: "address", name: "by", type: "address" },
    ],
    name: "Paused",
    type: "event",
  },
  {
    anonymous: false,
    inputs: [
      { indexed: true, internalType: "address", name: "player", type: "address" },
      { indexed: true, internalType: "bytes32", name: "purpose", type: "bytes32" },
      {
        indexed: false,
        internalType: "uint256",
        name: "timestamp",
        type: "uint256",
      },
    ],
    name: "SignedIn",
    type: "event",
  },
  {
    anonymous: false,
    inputs: [
      { indexed: true, internalType: "address", name: "by", type: "address" },
    ],
    name: "Unpaused",
    type: "event",
  },
  {
    anonymous: false,
    inputs: [
      { indexed: true, internalType: "address", name: "to", type: "address" },
      { indexed: false, internalType: "uint256", name: "amount", type: "uint256" },
    ],
    name: "WithdrawnUSDC",
    type: "event",
  },
  {
    anonymous: false,
    inputs: [
      { indexed: true, internalType: "address", name: "to", type: "address" },
      { indexed: false, internalType: "uint256", name: "amount", type: "uint256" },
    ],
    name: "WithdrawnUSDT",
    type: "event",
  },
  { stateMutability: "payable", type: "fallback" },
  {
    inputs: [],
    name: "USDC",
    outputs: [{ internalType: "address", name: "", type: "address" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [],
    name: "USDT",
    outputs: [{ internalType: "address", name: "", type: "address" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [],
    name: "acceptOwnership",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [{ internalType: "bytes32", name: "", type: "bytes32" }],
    name: "feeConfigured",
    outputs: [{ internalType: "bool", name: "", type: "bool" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [{ internalType: "bytes32", name: "", type: "bytes32" }],
    name: "feeOf",
    outputs: [{ internalType: "uint256", name: "", type: "uint256" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [],
    name: "getBalanceUSDC",
    outputs: [{ internalType: "uint256", name: "", type: "uint256" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [],
    name: "getBalanceUSDT",
    outputs: [{ internalType: "uint256", name: "", type: "uint256" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [{ internalType: "address", name: "player", type: "address" }],
    name: "getPayCount",
    outputs: [{ internalType: "uint256", name: "", type: "uint256" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [],
    name: "getStats",
    outputs: [
      { internalType: "uint256", name: "currentUSDT", type: "uint256" },
      { internalType: "uint256", name: "currentUSDC", type: "uint256" },
      { internalType: "uint256", name: "lifetimeUSDT", type: "uint256" },
      { internalType: "uint256", name: "lifetimeUSDC", type: "uint256" },
      { internalType: "uint256", name: "withdrawnUSDT", type: "uint256" },
      { internalType: "uint256", name: "withdrawnUSDC", type: "uint256" },
    ],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [],
    name: "owner",
    outputs: [{ internalType: "address", name: "", type: "address" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [],
    name: "pause",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [],
    name: "paused",
    outputs: [{ internalType: "bool", name: "", type: "bool" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [{ internalType: "address", name: "", type: "address" }],
    name: "payCountUSDC",
    outputs: [{ internalType: "uint256", name: "", type: "uint256" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [{ internalType: "address", name: "", type: "address" }],
    name: "payCountUSDT",
    outputs: [{ internalType: "uint256", name: "", type: "uint256" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [{ internalType: "bytes32", name: "purpose", type: "bytes32" }],
    name: "payWithUSDC",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [{ internalType: "bytes32", name: "purpose", type: "bytes32" }],
    name: "payWithUSDT",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [],
    name: "pendingOwner",
    outputs: [{ internalType: "address", name: "", type: "address" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [
      { internalType: "bytes32", name: "purpose", type: "bytes32" },
      { internalType: "uint256", name: "newFee", type: "uint256" },
    ],
    name: "setFee",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [{ internalType: "bytes32", name: "purpose", type: "bytes32" }],
    name: "signIn",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [{ internalType: "address", name: "", type: "address" }],
    name: "signInCount",
    outputs: [{ internalType: "uint256", name: "", type: "uint256" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [],
    name: "totalCollectedUSDC",
    outputs: [{ internalType: "uint256", name: "", type: "uint256" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [],
    name: "totalCollectedUSDT",
    outputs: [{ internalType: "uint256", name: "", type: "uint256" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [],
    name: "totalWithdrawnUSDC",
    outputs: [{ internalType: "uint256", name: "", type: "uint256" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [],
    name: "totalWithdrawnUSDT",
    outputs: [{ internalType: "uint256", name: "", type: "uint256" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [{ internalType: "address", name: "newOwner", type: "address" }],
    name: "transferOwnership",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [],
    name: "unpause",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [],
    name: "withdrawUSDC",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [],
    name: "withdrawUSDT",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
  { stateMutability: "payable", type: "receive" },
] as const;

/**
 * MiniPay write of ArcadeXTxHub.signIn — gas-only activity tx (e.g. Start Game).
 * No backend sync; receipt wait is best-effort like streak check-in.
 */
export async function signInOnChain(purpose: Hex): Promise<{ txHash: Hash }> {
  if (!isArcadeXTxHubConfigured()) {
    throw new Error("ArcadeXTxHub is not configured yet.");
  }

  const walletClient = createMiniPayWalletClient();
  if (!walletClient) {
    throw new Error("Open ArcadeX inside MiniPay to continue.");
  }

  const [account] = await walletClient.getAddresses();
  if (!account) {
    throw new Error("No wallet account available.");
  }

  const hash = await walletClient.writeContract({
    account,
    chain: celo,
    address: ARCADEX_TX_HUB_CONTRACT_ADDRESS,
    abi: ARCADEX_TX_HUB_ABI,
    functionName: "signIn",
    args: [purpose],
  });

  try {
    const receipt = await waitForCeloTransactionReceipt(hash);
    if (receipt.status !== "success") {
      throw new Error("Sign-in transaction failed.");
    }
  } catch (err) {
    if (
      err instanceof Error &&
      err.message.includes("Sign-in transaction failed.")
    ) {
      throw err;
    }
    // Tx was submitted — chain confirmation may still land.
  }

  return { txHash: hash };
}
