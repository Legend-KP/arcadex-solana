import {
  isWalletAddress,
  normalizeWalletAddress,
} from "@/lib/wallet-address";

const PLAYER_ID_KEY = "arcadex_player_id";
const PLAYER_NAME_KEY = "arcadex_player_name";
const WALLET_KEY = "arcadex_wallet_address";

export function clearInvalidCachedWallet(): void {
  if (typeof window === "undefined") return;
  const raw = localStorage.getItem(WALLET_KEY);
  if (raw && !isWalletAddress(raw)) {
    localStorage.removeItem(WALLET_KEY);
  }
}

/** Clears legacy guest UUIDs from localStorage (profiles are keyed by wallet only). */
export function clearStaleGuestId(): void {
  if (typeof window === "undefined") return;
  const id = localStorage.getItem(PLAYER_ID_KEY);
  if (id && !isWalletAddress(id)) {
    localStorage.removeItem(PLAYER_ID_KEY);
  }
}

export function getCachedWallet(): string | null {
  if (typeof window === "undefined") return null;
  const raw = localStorage.getItem(WALLET_KEY);
  if (!isWalletAddress(raw)) return null;
  return normalizeWalletAddress(raw!);
}

export function setCachedWallet(address: string): void {
  if (typeof window === "undefined") return;
  const normalized = normalizeWalletAddress(address);
  localStorage.setItem(WALLET_KEY, normalized);
  localStorage.setItem(PLAYER_ID_KEY, normalized);
}

export function getCachedPlayerName(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem(PLAYER_NAME_KEY);
}

export function setCachedPlayerName(name: string): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(PLAYER_NAME_KEY, name);
}

export function clearCachedPlayerName(): void {
  if (typeof window === "undefined") return;
  localStorage.removeItem(PLAYER_NAME_KEY);
}

