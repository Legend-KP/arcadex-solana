import {
  isWalletAddress,
  normalizeWalletAddress,
} from "@/lib/wallet-address";

const PLAYER_ID_KEY = "arcadex_player_id";
const PLAYER_NAME_KEY = "arcadex_player_name";
const WALLET_KEY = "arcadex_wallet_address";
const GUEST_SPARK_KEY = "arcadex_guest_sparks";

export function clearInvalidCachedWallet(): void {
  if (typeof window === "undefined") return;
  const raw = localStorage.getItem(WALLET_KEY);
  if (raw && !isWalletAddress(raw)) {
    localStorage.removeItem(WALLET_KEY);
  }
}

/**
 * Legacy cleanup kept for call sites. Guest UUIDs are valid again for
 * Solana Mobile / non-MiniPay play — do not wipe non-wallet player ids.
 */
export function clearStaleGuestId(): void {
  // no-op: guest ids are intentional for offline / APK WebView play
}

function createGuestUuid(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `guest-${Date.now().toString(36)}-${Math.random()
    .toString(36)
    .slice(2, 10)}`;
}

/** Local guest id for first-time / non-MiniPay users. */
export function getOrCreateGuestId(): string {
  if (typeof window === "undefined") return "";
  const existing = localStorage.getItem(PLAYER_ID_KEY);
  if (existing && !isWalletAddress(existing)) {
    return existing;
  }
  const id = createGuestUuid();
  localStorage.setItem(PLAYER_ID_KEY, id);
  return id;
}

export function getCachedPlayerId(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem(PLAYER_ID_KEY);
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

export function readGuestSparkStateJson(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem(GUEST_SPARK_KEY);
}

export function writeGuestSparkStateJson(json: string): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(GUEST_SPARK_KEY, json);
}
