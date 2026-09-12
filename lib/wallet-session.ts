import {
  assertRequiredSecrets,
  assertWalletSessionSecretConfigured,
} from "@/lib/required-secrets";
import { SignJWT, jwtVerify } from "jose";
import { verifyMessage } from "viem";
import { parseAuthChallengeMessage } from "@/lib/wallet-auth-message";
import { isWalletAddress, normalizeWalletAddress } from "@/lib/wallet-address";

const SESSION_TTL_SEC = 24 * 60 * 60;

/** True when a real session secret is present (never fail-open). */
export function isWalletAuthEnabled(): boolean {
  return Boolean(process.env.WALLET_SESSION_SECRET?.trim());
}

function getWalletSessionSecret(): Uint8Array {
  assertWalletSessionSecretConfigured();
  const secret = process.env.WALLET_SESSION_SECRET!.trim();
  return new TextEncoder().encode(secret);
}

export async function createWalletSessionToken(wallet: string): Promise<string> {
  const normalized = normalizeWalletAddress(wallet);
  return new SignJWT({ wallet: normalized })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${SESSION_TTL_SEC}s`)
    .sign(getWalletSessionSecret());
}

export async function verifyWalletSessionToken(
  token: string
): Promise<string | null> {
  try {
    const { payload } = await jwtVerify(token, getWalletSessionSecret());
    const wallet = payload.wallet;
    if (typeof wallet !== "string" || !isWalletAddress(wallet)) return null;
    return normalizeWalletAddress(wallet);
  } catch {
    return null;
  }
}

export function extractBearerToken(request: Request): string | null {
  const auth = request.headers.get("Authorization");
  if (!auth?.startsWith("Bearer ")) return null;
  const token = auth.slice(7).trim();
  return token || null;
}

/**
 * Bearer header, or `arcadexSession` query (Unity iframe self-fetch).
 * Prefer Authorization when both are present.
 */
export function extractSessionToken(request: Request): string | null {
  const bearer = extractBearerToken(request);
  if (bearer) return bearer;
  try {
    const fromQuery = new URL(request.url).searchParams
      .get("arcadexSession")
      ?.trim();
    return fromQuery || null;
  } catch {
    return null;
  }
}

export type WalletAuthResult =
  | { ok: true; wallet: string }
  | { ok: false; error: string; status: number };

/**
 * Always fail closed: missing secret → 503; missing/invalid token → 401/403.
 * Never trusts the caller-provided wallet address without a verified session.
 */
export async function requireWalletAuth(
  request: Request,
  walletAddress?: string
): Promise<WalletAuthResult> {
  try {
    assertRequiredSecrets();
    assertWalletSessionSecretConfigured();
  } catch {
    return {
      ok: false,
      error:
        "Server authentication is not configured. Set WALLET_SESSION_SECRET and redeploy.",
      status: 503,
    };
  }

  const token = extractSessionToken(request);
  if (!token) {
    return { ok: false, error: "Authentication required.", status: 401 };
  }

  const sessionWallet = await verifyWalletSessionToken(token);
  if (!sessionWallet) {
    return { ok: false, error: "Invalid or expired session.", status: 401 };
  }

  if (walletAddress) {
    if (!isWalletAddress(walletAddress)) {
      return { ok: false, error: "Invalid wallet address.", status: 400 };
    }
    const expected = normalizeWalletAddress(walletAddress);
    if (sessionWallet !== expected) {
      return {
        ok: false,
        error: "Wallet does not match authenticated session.",
        status: 403,
      };
    }
  }

  return { ok: true, wallet: sessionWallet };
}

export async function verifyWalletSignature(
  walletAddress: string,
  message: string,
  signature: string
): Promise<boolean> {
  const parsed = parseAuthChallengeMessage(message);
  if (!parsed) return false;

  const wallet = normalizeWalletAddress(walletAddress);
  if (parsed.wallet !== wallet) return false;

  try {
    return await verifyMessage({
      address: wallet as `0x${string}`,
      message,
      signature: signature as `0x${string}`,
    });
  } catch {
    return false;
  }
}
