import { getAddress, isAddress } from "viem";

export function isWalletAddress(value: string | null | undefined): boolean {
  if (!value?.trim()) return false;
  return isAddress(value.trim());
}

export function normalizeWalletAddress(address: string): string {
  const trimmed = address.trim();
  if (!isAddress(trimmed)) {
    throw new Error("Invalid wallet address");
  }
  return getAddress(trimmed);
}

export function tryNormalizeWalletAddress(
  address: string | null | undefined
): string | null {
  if (!isWalletAddress(address)) return null;
  return normalizeWalletAddress(address!);
}

/** Firestore/API paths — wallet addresses must be encoded in URLs. */
export function encodeUserId(userId: string): string {
  return encodeURIComponent(userId);
}

export function walletToFirestoreDocId(walletAddress: string): string {
  return normalizeWalletAddress(walletAddress);
}
