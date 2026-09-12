"use client";

const TOKEN_KEY = "arcadex_wallet_session";

function readToken(): string | null {
  if (typeof window === "undefined") return null;
  return (
    localStorage.getItem(TOKEN_KEY) ??
    sessionStorage.getItem(TOKEN_KEY)
  );
}

export function getWalletSessionToken(): string | null {
  return readToken();
}

export function setWalletSessionToken(token: string): void {
  localStorage.setItem(TOKEN_KEY, token);
  sessionStorage.setItem(TOKEN_KEY, token);
}

export function clearWalletSessionToken(): void {
  localStorage.removeItem(TOKEN_KEY);
  sessionStorage.removeItem(TOKEN_KEY);
}

function decodeJwtPayload(token: string): { wallet?: string; exp?: number } | null {
  const parts = token.split(".");
  if (parts.length !== 3) return null;

  try {
    const json = atob(parts[1].replace(/-/g, "+").replace(/_/g, "/"));
    return JSON.parse(json) as { wallet?: string; exp?: number };
  } catch {
    return null;
  }
}

export function hasValidWalletSession(wallet: string): boolean {
  const token = getWalletSessionToken();
  if (!token) return false;

  const payload = decodeJwtPayload(token);
  if (!payload?.wallet || !payload.exp) return false;
  if (payload.wallet.toLowerCase() !== wallet.toLowerCase()) return false;
  return payload.exp * 1000 > Date.now() + 60_000;
}

export function walletAuthHeaders(
  extra?: Record<string, string>
): Record<string, string> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...extra,
  };

  const token = getWalletSessionToken();
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  return headers;
}
