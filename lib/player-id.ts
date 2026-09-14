import {
  isWalletAddress,
  normalizeWalletAddress,
} from "@/lib/wallet-address";

const PLAYER_ID_KEY = "arcadex_player_id";
const PLAYER_NAME_KEY = "arcadex_player_name";
const WALLET_KEY = "arcadex_wallet_address";
const GUEST_SPARKS_KEY = "arcadex_guest_sparks";

function createGuestUuid(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `guest-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export function isGuestId(id: string | null | undefined): boolean {
  if (!id) return false;
  return !isWalletAddress(id);
}

export function clearInvalidCachedWallet(): void {
  if (typeof window === "undefined") return;
  const raw = localStorage.getItem(WALLET_KEY);
  if (raw && !isWalletAddress(raw)) {
    localStorage.removeItem(WALLET_KEY);
  }
}

/**
 * Guest UUIDs are valid for Solana Mobile / browser play without MiniPay.
 * Do not wipe them on boot — only clear when a real wallet takes over.
 */
export function clearStaleGuestId(): void {
  // no-op (kept for call-site compatibility)
}

export function getGuestId(): string | null {
  if (typeof window === "undefined") return null;
  const id = localStorage.getItem(PLAYER_ID_KEY);
  return isGuestId(id) ? id : null;
}

/** Stable local guest id for first-time users outside MiniPay. */
export function getOrCreateGuestId(): string {
  if (typeof window === "undefined") return "";
  const existing = getGuestId();
  if (existing) return existing;

  const id = createGuestUuid();
  localStorage.setItem(PLAYER_ID_KEY, id);
  return id;
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
  // Prefer wallet as the active player id when MiniPay connects.
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

export function getGuestSparksKey(guestId: string): string {
  return `${GUEST_SPARKS_KEY}:${guestId}`;
}
