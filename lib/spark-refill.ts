import type { Address } from "viem";

export const SPARK_REFILL_CONTRACT_ADDRESS =
  (process.env.NEXT_PUBLIC_SPARK_REFILL_CONTRACT ??
    "0xD7EA6F0212b5b54a9fA4fc2d805CE63426A48B18") as Address;

export const CELO_USDT_ADDRESS =
  "0x48065fbBE25f71C9282ddf5e1cD6D6A887483D5e" as Address;

export const CELO_USDC_ADDRESS =
  "0xcebA9300f2b948710d2653dD7B07f33A8B32118C" as Address;

/** CIP-64 fee-currency adapters (6-decimal tokens). */
export const CELO_USDT_FEE_CURRENCY =
  "0x0e2a3e05bc9a16f5292a6170456a710cb89c6f72" as Address;

export const CELO_USDC_FEE_CURRENCY =
  "0x2F25deB3848C207fc8E0c34035B3Ba7fC157602B" as Address;

export const STABLECOIN_DECIMALS = 6;

export type SparkRefillPaymentToken = "USDT" | "USDC";

export const SPARK_REFILL_ABI = [
  { inputs: [], stateMutability: "nonpayable", type: "constructor" },
  {
    anonymous: false,
    inputs: [
      { indexed: true, internalType: "address", name: "player", type: "address" },
      { indexed: true, internalType: "address", name: "token", type: "address" },
      { indexed: false, internalType: "uint256", name: "amount", type: "uint256" },
      { indexed: false, internalType: "uint256", name: "timestamp", type: "uint256" },
    ],
    name: "EntryPaid",
    type: "event",
  },
  {
    anonymous: false,
    inputs: [
      { indexed: false, internalType: "uint256", name: "oldFee", type: "uint256" },
      { indexed: false, internalType: "uint256", name: "newFee", type: "uint256" },
    ],
    name: "FeeUpdated",
    type: "event",
  },
  {
    anonymous: false,
    inputs: [
      { indexed: true, internalType: "address", name: "previousOwner", type: "address" },
      { indexed: true, internalType: "address", name: "pendingOwner", type: "address" },
    ],
    name: "OwnershipTransferStarted",
    type: "event",
  },
  {
    anonymous: false,
    inputs: [
      { indexed: true, internalType: "address", name: "previousOwner", type: "address" },
      { indexed: true, internalType: "address", name: "newOwner", type: "address" },
    ],
    name: "OwnershipTransferred",
    type: "event",
  },
  {
    anonymous: false,
    inputs: [{ indexed: true, internalType: "address", name: "by", type: "address" }],
    name: "Paused",
    type: "event",
  },
  {
    anonymous: false,
    inputs: [{ indexed: true, internalType: "address", name: "by", type: "address" }],
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
    inputs: [],
    name: "fee",
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
    inputs: [{ internalType: "address", name: "player", type: "address" }],
    name: "getPayCountUSDC",
    outputs: [{ internalType: "uint256", name: "", type: "uint256" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [{ internalType: "address", name: "player", type: "address" }],
    name: "getPayCountUSDT",
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
    inputs: [],
    name: "payWithUSDC",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [],
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
    inputs: [{ internalType: "uint256", name: "newFee", type: "uint256" }],
    name: "setFee",
    outputs: [],
    stateMutability: "nonpayable",
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

export const ERC20_ABI = [
  {
    inputs: [
      { name: "owner", type: "address" },
      { name: "spender", type: "address" },
    ],
    name: "allowance",
    outputs: [{ name: "", type: "uint256" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [
      { name: "spender", type: "address" },
      { name: "value", type: "uint256" },
    ],
    name: "approve",
    outputs: [{ name: "", type: "bool" }],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [{ name: "account", type: "address" }],
    name: "balanceOf",
    outputs: [{ name: "", type: "uint256" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [
      { name: "to", type: "address" },
      { name: "value", type: "uint256" },
    ],
    name: "transfer",
    outputs: [{ name: "", type: "bool" }],
    stateMutability: "nonpayable",
    type: "function",
  },
] as const;

export function tokenAddress(token: SparkRefillPaymentToken): Address {
  return token === "USDT" ? CELO_USDT_ADDRESS : CELO_USDC_ADDRESS;
}

export function tokenFeeCurrency(token: SparkRefillPaymentToken): Address {
  return token === "USDT" ? CELO_USDT_FEE_CURRENCY : CELO_USDC_FEE_CURRENCY;
}
