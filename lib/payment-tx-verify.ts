import {
  decodeEventLog,
  getAddress,
  type Address,
  type Hash,
  type Abi,
  type TransactionReceipt,
} from "viem";
import {
  getCeloPublicClient,
  resetCeloPublicClient,
  isBlockOutOfRangeError,
} from "@/lib/celo-public-client";

const RECEIPT_RETRY_DELAYS_MS = [0, 500, 1200, 2500];

const ERC20_TRANSFER_EVENT_ABI = [
  {
    type: "event",
    name: "Transfer",
    inputs: [
      { name: "from", type: "address", indexed: true },
      { name: "to", type: "address", indexed: true },
      { name: "value", type: "uint256", indexed: false },
    ],
  },
] as const;

function collectErrorText(error: unknown): string {
  if (!(error instanceof Error)) return String(error);
  const parts: string[] = [error.message];
  let cause: unknown = error.cause;
  while (cause instanceof Error) {
    parts.push(cause.message);
    cause = cause.cause;
  }
  return parts.join(" ");
}

function isTransientReceiptError(error: unknown): boolean {
  const message = collectErrorText(error).toLowerCase();
  return (
    isBlockOutOfRangeError(error) ||
    message.includes("could not be found") ||
    message.includes("not found") ||
    message.includes("timeout") ||
    message.includes("fetch failed") ||
    message.includes("network") ||
    message.includes("429") ||
    message.includes("rate limit") ||
    message.includes("503") ||
    message.includes("502")
  );
}

/** Fetch a receipt with retries and RPC rotation — critical right after MiniPay confirms. */
export async function getPaymentTransactionReceipt(
  txHash: Hash
): Promise<TransactionReceipt> {
  let lastError: unknown;

  for (let attempt = 0; attempt < RECEIPT_RETRY_DELAYS_MS.length; attempt++) {
    if (attempt > 0) {
      await new Promise((resolve) =>
        setTimeout(resolve, RECEIPT_RETRY_DELAYS_MS[attempt])
      );
      resetCeloPublicClient();
    }

    try {
      const receipt = await getCeloPublicClient().getTransactionReceipt({
        hash: txHash,
      });
      if (receipt) return receipt;
    } catch (error) {
      lastError = error;
      if (!isTransientReceiptError(error)) throw error;
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new Error("Could not load payment transaction receipt.");
}

export type StablePaymentToken = "USDT" | "USDC";

export interface VerifiedStablePayment {
  player: Address;
  token: StablePaymentToken;
  amount: bigint;
}

async function readLatestContractValue<T>(
  contractAddress: Address,
  abi: Abi,
  functionName: "fee" | "paused"
): Promise<T> {
  try {
    return (await getCeloPublicClient().readContract({
      address: contractAddress,
      abi,
      functionName,
      blockTag: "latest",
    })) as T;
  } catch (error) {
    if (isBlockOutOfRangeError(error) || isTransientReceiptError(error)) {
      resetCeloPublicClient();
      return (await getCeloPublicClient().readContract({
        address: contractAddress,
        abi,
        functionName,
        blockTag: "latest",
      })) as T;
    }
    throw error;
  }
}

function tokenFromAddress(
  token: Address,
  usdtAddress: Address,
  usdcAddress: Address
): StablePaymentToken {
  const tokenLower = token.toLowerCase();
  if (tokenLower === usdtAddress.toLowerCase()) return "USDT";
  if (tokenLower === usdcAddress.toLowerCase()) return "USDC";
  throw new Error("Payment token is not USDT or USDC.");
}

function verifyDirectTransferPayment(options: {
  receipt: TransactionReceipt;
  expectedPlayer: Address;
  contractAddress: Address;
  usdtAddress: Address;
  usdcAddress: Address;
  fee: bigint;
}): VerifiedStablePayment | null {
  const {
    receipt,
    expectedPlayer,
    contractAddress,
    usdtAddress,
    usdcAddress,
    fee,
  } = options;

  let matched: VerifiedStablePayment | null = null;
  let bestBelowFee: bigint | null = null;

  for (const log of receipt.logs) {
    const logToken = log.address.toLowerCase();
    if (
      logToken !== usdtAddress.toLowerCase() &&
      logToken !== usdcAddress.toLowerCase()
    ) {
      continue;
    }

    try {
      const decoded = decodeEventLog({
        abi: ERC20_TRANSFER_EVENT_ABI,
        data: log.data,
        topics: log.topics,
      });
      if (decoded.eventName !== "Transfer") continue;

      const { from, to, value } = decoded.args;
      if (getAddress(from) !== expectedPlayer) continue;
      if (getAddress(to) !== getAddress(contractAddress)) continue;

      if (value < fee) {
        if (bestBelowFee === null || value > bestBelowFee) {
          bestBelowFee = value;
        }
        continue;
      }

      if (!matched || value > matched.amount) {
        matched = {
          player: expectedPlayer,
          token: tokenFromAddress(log.address, usdtAddress, usdcAddress),
          amount: value,
        };
      }
    } catch (error) {
      if (error instanceof Error && error.message.includes("Payment token")) {
        throw error;
      }
    }
  }

  if (matched) return matched;

  if (bestBelowFee !== null) {
    throw new Error("Payment amount is below the contract fee.");
  }

  // Prefer Transfer(from=player) over receipt.from — CIP-64 fee txs can look odd on some RPCs.
  if (getAddress(receipt.from) !== expectedPlayer) {
    throw new Error("Payment wallet does not match your account.");
  }

  return null;
}

function verifyEntryPaidEvent(options: {
  receipt: TransactionReceipt;
  expectedPlayer: Address;
  contractAddress: Address;
  abi: Abi;
  usdtAddress: Address;
  usdcAddress: Address;
  fee: bigint;
}): VerifiedStablePayment | null {
  const {
    receipt,
    expectedPlayer,
    contractAddress,
    abi,
    usdtAddress,
    usdcAddress,
    fee,
  } = options;

  for (const log of receipt.logs) {
    if (log.address.toLowerCase() !== contractAddress.toLowerCase()) {
      continue;
    }

    try {
      const decoded = decodeEventLog({
        abi,
        data: log.data,
        topics: log.topics,
      });

      if (decoded.eventName !== "EntryPaid") continue;

      const args = decoded.args as unknown as {
        player: Address;
        token: Address;
        amount: bigint;
      };
      const { player, token, amount } = args;

      if (getAddress(player) !== expectedPlayer) {
        throw new Error("Payment wallet does not match your account.");
      }

      if (amount < fee) {
        throw new Error("Payment amount is below the contract fee.");
      }

      return {
        player: expectedPlayer,
        token: tokenFromAddress(token, usdtAddress, usdcAddress),
        amount,
      };
    } catch (error) {
      if (error instanceof Error && error.message.includes("Payment wallet")) {
        throw error;
      }
      if (error instanceof Error && error.message.includes("Payment token")) {
        throw error;
      }
      if (error instanceof Error && error.message.includes("Payment amount")) {
        throw error;
      }
    }
  }

  return null;
}

/**
 * Verify a MiniPay payment to a SparkRefill-style contract.
 * Accepts a direct ERC-20 transfer into the contract (current flow) or a
 * legacy payWith* tx that emitted EntryPaid.
 */
export async function verifyEntryPaidPaymentTx(options: {
  walletAddress: string;
  txHash: Hash;
  contractAddress: Address;
  abi: Abi;
  usdtAddress: Address;
  usdcAddress: Address;
  contractLabel: string;
}): Promise<VerifiedStablePayment> {
  const {
    walletAddress,
    txHash,
    contractAddress,
    abi,
    usdtAddress,
    usdcAddress,
    contractLabel,
  } = options;

  const expectedPlayer = getAddress(walletAddress);
  const receipt = await getPaymentTransactionReceipt(txHash);

  if (receipt.status !== "success") {
    throw new Error("Transaction did not succeed.");
  }

  const paused = await readLatestContractValue<boolean>(
    contractAddress,
    abi,
    "paused"
  );
  if (paused) {
    throw new Error(`${contractLabel} payments are paused.`);
  }

  const fee = await readLatestContractValue<bigint>(
    contractAddress,
    abi,
    "fee"
  );

  const direct = verifyDirectTransferPayment({
    receipt,
    expectedPlayer,
    contractAddress,
    usdtAddress,
    usdcAddress,
    fee,
  });
  if (direct) return direct;

  const legacy = verifyEntryPaidEvent({
    receipt,
    expectedPlayer,
    contractAddress,
    abi,
    usdtAddress,
    usdcAddress,
    fee,
  });
  if (legacy) return legacy;

  throw new Error(`Payment to ${contractLabel} not found in transaction.`);
}
