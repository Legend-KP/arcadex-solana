/**
 * Solana address helpers (base58 pubkeys). Do not use viem/EVM isAddress here.
 */

const BASE58_RE = /^[1-9A-HJ-NP-Za-km-z]+$/;

export function isSolanaAddress(value: string | null | undefined): boolean {
  if (!value || typeof value !== "string") return false;
  const trimmed = value.trim();
  // Ed25519 pubkeys encode to ~32–44 base58 chars.
  if (trimmed.length < 32 || trimmed.length > 44) return false;
  return BASE58_RE.test(trimmed);
}

export function truncateSolanaAddress(
  address: string,
  left = 4,
  right = 4
): string {
  if (!address) return "";
  if (address.length <= left + right + 1) return address;
  return `${address.slice(0, left)}…${address.slice(-right)}`;
}

const SOLANA_ADDRESS_KEY = "arcadex_solana_address";
const SOLANA_LABEL_KEY = "arcadex_solana_label";

export function getCachedSolanaAddress(): string | null {
  if (typeof window === "undefined") return null;
  const raw = localStorage.getItem(SOLANA_ADDRESS_KEY);
  if (!raw) return null;
  return isSolanaAddress(raw) ? raw.trim() : null;
}

export function setCachedSolanaAddress(
  address: string,
  label?: string
): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(SOLANA_ADDRESS_KEY, address.trim());
  if (label) localStorage.setItem(SOLANA_LABEL_KEY, label);
  else localStorage.removeItem(SOLANA_LABEL_KEY);
}

export function clearCachedSolanaAddress(): void {
  if (typeof window === "undefined") return;
  localStorage.removeItem(SOLANA_ADDRESS_KEY);
  localStorage.removeItem(SOLANA_LABEL_KEY);
}

export function getCachedSolanaLabel(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem(SOLANA_LABEL_KEY);
}
