"use client";

import {
  createMiniPayWalletClient,
  getInjectedProvider,
  isMiniPay,
} from "@/lib/minipay";
import {
  isWalletAddress,
  normalizeWalletAddress,
} from "@/lib/wallet-address";
import { clearInvalidCachedWallet, setCachedWallet } from "@/lib/player-id";
import { setWalletSessionToken, hasValidWalletSession, getWalletSessionToken } from "@/lib/wallet-session-client";

const POLL_MS = 200;
const MAX_WAIT_MS = 15000;

let memoryCachedWallet: string | null = null;

export function getMemoryCachedWallet(): string | null {
  const fromMemory = memoryCachedWallet;
  if (isWalletAddress(fromMemory)) {
    return normalizeWalletAddress(fromMemory!);
  }
  return getCachedWalletFromStorage();
}

function getCachedWalletFromStorage(): string | null {
  if (typeof window === "undefined") return null;
  const raw = localStorage.getItem("arcadex_wallet_address");
  if (!isWalletAddress(raw)) return null;
  return normalizeWalletAddress(raw!);
}

function cacheWallet(address: string): string {
  const normalized = normalizeWalletAddress(address);
  memoryCachedWallet = normalized;
  setCachedWallet(normalized);
  return normalized;
}

async function readAddressFromProvider(): Promise<string | null> {
  const client = createMiniPayWalletClient();
  if (!client) return null;

  try {
    const [address] = await client.getAddresses();
    if (isWalletAddress(address)) {
      return normalizeWalletAddress(address);
    }
  } catch {
    // Provider not ready yet
  }

  const provider = getInjectedProvider();
  if (!provider?.request) return null;

  try {
    const accounts = (await provider.request({
      method: "eth_accounts",
    })) as string[] | undefined;
    const first = accounts?.[0];
    if (first && isWalletAddress(first)) {
      return normalizeWalletAddress(first);
    }
  } catch {
    // Ignore — wallet may not be connected yet
  }

  return null;
}

/** Instant read — no provider polling. */
export function readWalletImmediately(): string | null {
  const cached = getMemoryCachedWallet();
  if (cached) return cached;
  return null;
}

async function waitForProviderWallet(
  timeoutMs = MAX_WAIT_MS
): Promise<string | null> {
  const start = Date.now();

  while (Date.now() - start < timeoutMs) {
    const wallet = await readAddressFromProvider();
    if (wallet) return wallet;
    await new Promise((r) => setTimeout(r, POLL_MS));
  }

  return readAddressFromProvider();
}

/** Resolve wallet on app open via MiniPay injected provider (no message signing). */
export async function resolveWalletOnAppOpen(): Promise<string | null> {
  clearInvalidCachedWallet();

  const cached = getMemoryCachedWallet();
  if (cached) return cached;

  const immediate = await readAddressFromProvider();
  if (immediate) return cacheWallet(immediate);

    const fromProvider = await waitForProviderWallet(1200);
  if (fromProvider) return cacheWallet(fromProvider);

  return null;
}

/** Quick re-read after auto-connect — avoids repeating the full init wait. */
export async function retryResolveWallet(): Promise<string | null> {
  const cached = getMemoryCachedWallet();
  if (cached) return cached;

  const immediate = await readAddressFromProvider();
  if (immediate) return cacheWallet(immediate);

    const fromProvider = await waitForProviderWallet(1200);
  return fromProvider ? cacheWallet(fromProvider) : null;
}

function walletInitErrorMessage(): string {
  if (!isMiniPay()) {
    return "Open ArcadeX inside MiniPay to continue.";
  }
  return "Could not connect to your MiniPay wallet. Update MiniPay and try again.";
}

/** Resolve wallet for saving profile — requires signed session. */
export async function resolveWalletForSave(): Promise<string> {
  const silent = await resolveWalletOnAppOpen();
  if (silent) return silent;

  const wallet = await waitForProviderWallet();
  if (wallet) return cacheWallet(wallet);

  throw new Error(walletInitErrorMessage());
}

/**
 * Fallback message-signing auth (used when daily check-in is not available yet).
 * Preferred sign-in with ArcadeXRewards: `performDailyCheckIn` → `/api/streak/sync`.
 */
export async function establishWalletSession(wallet: string): Promise<string> {
  const normalized = normalizeWalletAddress(wallet);
  const client = createMiniPayWalletClient();
  if (!client) {
    throw new Error(walletInitErrorMessage());
  }

  const challengeRes = await fetch("/api/auth/challenge", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ walletAddress: normalized }),
    cache: "no-store",
  });

  const challenge = (await challengeRes.json().catch(() => ({}))) as {
    message?: string;
    error?: string;
  };

  if (!challengeRes.ok || !challenge.message) {
    throw new Error(challenge.error ?? "Could not start wallet authentication.");
  }

  const signature = await client.signMessage({
    account: normalized as `0x${string}`,
    message: challenge.message,
  });

  const sessionRes = await fetch("/api/auth/session", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      walletAddress: normalized,
      message: challenge.message,
      signature,
    }),
    cache: "no-store",
  });

  const session = (await sessionRes.json().catch(() => ({}))) as {
    token?: string;
    error?: string;
  };

  if (!sessionRes.ok || !session.token) {
    throw new Error(session.error ?? "Wallet authentication failed.");
  }

  setWalletSessionToken(session.token);
  return session.token;
}

/** Ensure a valid wallet session exists for the connected wallet. */
export async function ensureWalletSession(wallet: string): Promise<string> {
  const normalized = normalizeWalletAddress(wallet);
  if (hasValidWalletSession(normalized)) {
    return getWalletSessionToken()!;
  }

  try {
    return await establishWalletSession(normalized);
  } catch (err) {
    throw new Error(
      err instanceof Error
        ? err.message
        : "Could not authenticate your wallet. Open ArcadeX in MiniPay and try again."
    );
  }
}
