import {
  createPublicClient,
  hexToBigInt,
  http,
  type Address,
  type Hash,
  type TransactionReceipt,
} from "viem";
import { celo } from "viem/chains";

const DEFAULT_RPC_URLS = [
  "https://forno.celo.org",
  "https://rpc.ankr.com/celo",
  "https://1rpc.io/celo",
] as const;

function getRpcUrls(): string[] {
  const primary = process.env.NEXT_PUBLIC_CELO_RPC_URL?.trim();
  const urls = primary
    ? [primary, ...DEFAULT_RPC_URLS.filter((url) => url !== primary)]
    : [...DEFAULT_RPC_URLS];
  return [...new Set(urls)];
}

const publicClientConfig = {
  chain: celo,
  batch: { multicall: false },
  cacheTime: 0,
} as const;

function createHttpClient(rpcUrl: string) {
  return createPublicClient({
    ...publicClientConfig,
    transport: http(rpcUrl, { timeout: 12_000 }),
  });
}

type CeloPublicClient = ReturnType<typeof createHttpClient>;

let browserClient: CeloPublicClient | null = null;
let browserClientIndex = 0;

function createBrowserPublicClient(): CeloPublicClient {
  const urls = getRpcUrls();
  const url = urls[browserClientIndex % urls.length] ?? urls[0]!;
  return createHttpClient(url);
}

/** Public client for browser-side chain reads (payments, balances). */
export function getCeloPublicClient(): CeloPublicClient {
  if (typeof window !== "undefined") {
    browserClient ??= createBrowserPublicClient();
    return browserClient;
  }

  return createHttpClient(getRpcUrls()[0]!);
}

/** Reset cached browser client and rotate to the next RPC URL. */
export function resetCeloPublicClient(): void {
  browserClient = null;
  const urls = getRpcUrls();
  if (urls.length > 0) {
    browserClientIndex = (browserClientIndex + 1) % urls.length;
  }
}

function collectErrorText(error: unknown): string {
  if (error instanceof Error) {
    const parts: string[] = [error.message];
    let cause: unknown = error.cause;
    while (cause instanceof Error) {
      parts.push(cause.message);
      cause = cause.cause;
    }
    return parts.join(" ");
  }

  if (typeof error === "string") return error;

  if (typeof error === "object" && error !== null) {
    const record = error as Record<string, unknown>;
    const parts: string[] = [];

    if (typeof record.message === "string" && record.message.trim()) {
      parts.push(record.message.trim());
    }
    if (typeof record.reason === "string" && record.reason.trim()) {
      parts.push(record.reason.trim());
    }
    if (typeof record.details === "string" && record.details.trim()) {
      parts.push(record.details.trim());
    }
    if (typeof record.shortMessage === "string" && record.shortMessage.trim()) {
      parts.push(record.shortMessage.trim());
    }
    if (typeof record.code === "number" || typeof record.code === "string") {
      parts.push(`code ${record.code}`);
    }
    if (record.data && typeof record.data === "object") {
      const data = record.data as Record<string, unknown>;
      if (typeof data.message === "string" && data.message.trim()) {
        parts.push(data.message.trim());
      }
    }

    if (parts.length > 0) return parts.join(" | ");

    try {
      return JSON.stringify(error);
    } catch {
      return "Unknown wallet error";
    }
  }

  return String(error);
}

export function isBlockOutOfRangeError(error: unknown): boolean {
  const message = collectErrorText(error).toLowerCase();
  return (
    message.includes("block is out of range") ||
    message.includes("header not found") ||
    message.includes("invalid block tag")
  );
}

function isTransientRpcError(error: unknown): boolean {
  const message = collectErrorText(error).toLowerCase();
  return (
    isBlockOutOfRangeError(error) ||
    message.includes("timeout") ||
    message.includes("fetch failed") ||
    message.includes("network") ||
    message.includes("429") ||
    message.includes("rate limit") ||
    message.includes("503") ||
    message.includes("502")
  );
}

function isTransactionFailureError(error: unknown): boolean {
  const message = collectErrorText(error).toLowerCase();
  // Do NOT match "version: viem" — almost every viem error includes that footer
  // and was incorrectly shown as a generic "Transaction failed".
  return (
    message.includes("execution reverted") ||
    message.includes("transaction failed") ||
    message.includes("intrinsic gas too low") ||
    message.includes("insufficient funds for gas")
  );
}

function shortChainErrorMessage(error: unknown): string | null {
  const raw = collectErrorText(error);
  if (!raw || raw === "[object Object]") return null;

  const firstLine = raw.split("\n")[0]?.trim() ?? "";
  const withoutViemFooter = firstLine
    .replace(/\s*Version: viem.*$/i, "")
    .replace(/\s*Details:.*$/i, "")
    .replace(/\s*\|\s*code\s+-?\d+\s*$/i, "")
    .trim();

  if (
    withoutViemFooter &&
    withoutViemFooter.length > 0 &&
    withoutViemFooter.length <= 180 &&
    !withoutViemFooter.toLowerCase().includes("rpc request failed")
  ) {
    return withoutViemFooter;
  }

  return null;
}

/** Map low-level RPC / MiniPay errors to short user-facing messages. */
export function formatChainError(error: unknown): string {
  const text = collectErrorText(error);

  // TEMP debug payloads from purchaseStablecoinFeeOnChain — show as-is in MiniPay UI.
  if (/^\[[a-zA-Z0-9_:-]+\]\s/.test(text)) {
    return text.length > 420 ? `${text.slice(0, 417)}...` : text;
  }

  if (
    text.includes("Insufficient balance") ||
    text.includes("Connect your wallet") ||
    text.includes("No wallet") ||
    text.includes("approval failed") ||
    text.includes("payment failed") ||
    text.includes("Payments are paused") ||
    text.includes("Almost enough") ||
    text.includes("network fee") ||
    text.includes("Payment cancelled") ||
    text.includes("MiniPay did not return") ||
    text.includes("Open ArcadeX inside MiniPay")
  ) {
    // Prefer the first recognizable sentence from our own errors.
    const match = text.match(
      /((?:Insufficient balance|Connect your wallet|No wallet|Almost enough|Payments are paused|Payment cancelled|MiniPay did not return|Open ArcadeX inside MiniPay|[^|]*)[^.]*\.?)/
    );
    const candidate = (match?.[1] ?? text).trim();
    if (candidate && candidate !== "[object Object]") {
      return candidate.length > 180 ? `${candidate.slice(0, 177)}...` : candidate;
    }
  }

  if (isUserFacingRejection(error)) {
    return "Payment cancelled in MiniPay.";
  }

  const short = shortChainErrorMessage(error);
  if (short) return short;

  if (isTransactionFailureError(error)) {
    return "Transaction failed. Please try again.";
  }

  if (text.toLowerCase().includes("unknown rpc error")) {
    return "MiniPay could not prepare the payment. Please close and try again.";
  }

  if (isTransientRpcError(error)) {
    return "The network is temporarily unavailable. Please wait a moment and try again.";
  }

  if (text && text !== "[object Object]" && text.length <= 180) {
    return text;
  }

  if (
    text.includes("RPC Request failed") ||
    text.includes("Request body") ||
    text.length > 180
  ) {
    return "Could not reach the Celo network. Please try again.";
  }

  return "Something went wrong. Please try again.";
}

function isUserFacingRejection(error: unknown): boolean {
  const message = collectErrorText(error).toLowerCase();
  const code =
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (typeof (error as { code?: unknown }).code === "number" ||
      typeof (error as { code?: unknown }).code === "string")
      ? Number((error as { code: number | string }).code)
      : null;

  return (
    code === 4001 ||
    message.includes("user rejected") ||
    message.includes("user denied") ||
    message.includes("rejected the request") ||
    message.includes("request rejected")
  );
}

type ReadContractParams = Parameters<CeloPublicClient["readContract"]>[0];

const RETRY_DELAYS_MS = [0, 400, 900];

async function withCeloRpcRetry<T>(fn: (client: CeloPublicClient) => Promise<T>): Promise<T> {
  let lastError: unknown;

  for (let attempt = 0; attempt < RETRY_DELAYS_MS.length; attempt++) {
    if (attempt > 0) {
      await new Promise((resolve) => setTimeout(resolve, RETRY_DELAYS_MS[attempt]));
      resetCeloPublicClient();
    }

    try {
      return await fn(getCeloPublicClient());
    } catch (error) {
      lastError = error;
      if (!isTransientRpcError(error)) throw error;
    }
  }

  for (const rpcUrl of getRpcUrls()) {
    try {
      return await fn(createHttpClient(rpcUrl));
    } catch (error) {
      lastError = error;
      if (!isTransientRpcError(error)) throw error;
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new Error("Could not reach the Celo network. Please try again.");
}

export async function readCeloContract(
  params: ReadContractParams
): Promise<bigint> {
  return withCeloRpcRetry(async (client) => {
    return (await client.readContract({
      ...params,
      blockTag: "latest",
    })) as bigint;
  });
}

/** Retry-safe contract read for non-bigint returns (e.g. paused()). */
export async function readCeloContractValue<T>(
  params: ReadContractParams
): Promise<T> {
  return withCeloRpcRetry(async (client) => {
    return (await client.readContract({
      ...params,
      blockTag: "latest",
    })) as T;
  });
}

/**
 * Gas price denominated in a CIP-64 fee currency (adapter for USDC/USDT).
 * Uses public RPCs — never MiniPay's provider (eth_gasPrice + feeCurrency
 * often returns "An unknown RPC error" in the MiniPay webview).
 */
export async function getCeloFeeCurrencyGasPrice(
  feeCurrency: Address
): Promise<bigint> {
  return withCeloRpcRetry(async (client) => {
    // Celo CIP-64 extends eth_gasPrice with params: [feeCurrencyAddress].
    // Standard EIP-1193 typings omit that param, so cast the request.
    const priceHex = (await client.request({
      method: "eth_gasPrice",
      params: [feeCurrency],
    } as never)) as `0x${string}`;
    return hexToBigInt(priceHex);
  });
}

/** Retry-safe nonce from public RPC so MiniPay is not asked for eth_getTransactionCount. */
export async function getCeloTransactionCount(address: Address): Promise<number> {
  return withCeloRpcRetry(async (client) => {
    return client.getTransactionCount({ address, blockTag: "pending" });
  });
}

const RECEIPT_RETRY_DELAYS_MS = [0, 500, 1200, 2500, 4000];

function isTransientReceiptError(error: unknown): boolean {
  const message = collectErrorText(error).toLowerCase();
  return (
    isTransientRpcError(error) ||
    message.includes("could not be found") ||
    message.includes("not found") ||
    message.includes("timed out") ||
    message.includes("wait for transaction")
  );
}

/**
 * Wait for a tx receipt with RPC rotation. Prefer this right after MiniPay
 * confirms a write — a single Forno flake otherwise traps users mid-sign-in.
 */
export async function waitForCeloTransactionReceipt(
  hash: Hash,
  opts?: { confirmations?: number; timeoutMs?: number }
): Promise<TransactionReceipt> {
  let lastError: unknown;
  const timeout = opts?.timeoutMs ?? 45_000;
  const confirmations = opts?.confirmations ?? 1;

  for (let attempt = 0; attempt < RECEIPT_RETRY_DELAYS_MS.length; attempt++) {
    if (attempt > 0) {
      await new Promise((resolve) =>
        setTimeout(resolve, RECEIPT_RETRY_DELAYS_MS[attempt])
      );
      resetCeloPublicClient();
    }

    try {
      return await getCeloPublicClient().waitForTransactionReceipt({
        hash,
        confirmations,
        timeout,
      });
    } catch (error) {
      lastError = error;
      if (!isTransientReceiptError(error)) throw error;
    }
  }

  for (const rpcUrl of getRpcUrls()) {
    try {
      return await createHttpClient(rpcUrl).waitForTransactionReceipt({
        hash,
        confirmations,
        timeout: Math.min(timeout, 20_000),
      });
    } catch (error) {
      lastError = error;
      if (!isTransientReceiptError(error)) throw error;
    }
  }

  // Last resort: poll getTransactionReceipt across RPCs (tx may already be mined).
  for (const rpcUrl of getRpcUrls()) {
    try {
      const receipt = await createHttpClient(rpcUrl).getTransactionReceipt({
        hash,
      });
      if (receipt) return receipt;
    } catch (error) {
      lastError = error;
      if (!isTransientReceiptError(error)) throw error;
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new Error("Could not confirm the transaction on Celo.");
}
