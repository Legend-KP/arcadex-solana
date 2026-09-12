import { isWalletAddress, normalizeWalletAddress } from "@/lib/wallet-address";

const MESSAGE_PREFIX = "Sign in to ArcadeX";
export const CHALLENGE_MAX_AGE_MS = 5 * 60 * 1000;

export function buildAuthChallengeMessage(
  wallet: string,
  nonce: string,
  issuedAt: string
): string {
  return `${MESSAGE_PREFIX}\n\nWallet: ${wallet}\nNonce: ${nonce}\nIssued at: ${issuedAt}`;
}

export function parseAuthChallengeMessage(
  message: string
): { wallet: string; nonce: string; issuedAt: string } | null {
  if (!message.startsWith(`${MESSAGE_PREFIX}\n`)) return null;

  const walletMatch = message.match(/^Wallet: (0x[a-fA-F0-9]{40})$/m);
  const nonceMatch = message.match(/^Nonce: ([0-9a-f-]{36})$/m);
  const issuedMatch = message.match(/^Issued at: (.+)$/m);

  const walletRaw = walletMatch?.[1];
  const nonce = nonceMatch?.[1];
  const issuedAt = issuedMatch?.[1]?.trim();

  if (!walletRaw || !nonce || !issuedAt || !isWalletAddress(walletRaw)) {
    return null;
  }

  const issuedMs = Date.parse(issuedAt);
  if (!Number.isFinite(issuedMs)) return null;

  const ageMs = Date.now() - issuedMs;
  if (ageMs < 0 || ageMs > CHALLENGE_MAX_AGE_MS) return null;

  return {
    wallet: normalizeWalletAddress(walletRaw),
    nonce,
    issuedAt,
  };
}
