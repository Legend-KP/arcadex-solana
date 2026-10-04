import { getArcadexWebUrl } from "../config";

function apiBase() {
  return getArcadexWebUrl().replace(/\/$/, "");
}

async function parseJson(res) {
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = data.error || data.message || `Request failed (${res.status})`;
    const err = new Error(msg);
    err.code = data.code;
    err.status = res.status;
    throw err;
  }
  return data;
}

export async function fetchGames() {
  const res = await fetch(`${apiBase()}/api/games`, { cache: "no-store" });
  const data = await parseJson(res);
  return {
    games: Array.isArray(data.games) ? data.games : [],
    playCounts: data.playCounts || {},
  };
}

export async function fetchActivityLeaderboard() {
  const res = await fetch(`${apiBase()}/api/leaderboard/activity`, {
    cache: "no-store",
  });
  const data = await parseJson(res);
  return Array.isArray(data.entries) ? data.entries : [];
}

export function logoUrl() {
  return `${apiBase()}/arcadeX.webp`;
}

export function logoFallbackUrl() {
  return `${apiBase()}/arcadeX.webp`;
}

export async function createWalletSession({
  walletAddress,
  message,
  signatureBase64,
}) {
  const res = await fetch(`${apiBase()}/api/wallet/session`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ walletAddress, message, signatureBase64 }),
    cache: "no-store",
  });
  return parseJson(res);
}

export async function bootstrapPlayer(walletAddress, token) {
  const res = await fetch(`${apiBase()}/api/bootstrap`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ walletAddress }),
    cache: "no-store",
  });
  return parseJson(res);
}

export async function savePlayerName(walletAddress, name, token) {
  const headers = { "content-type": "application/json" };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(
    `${apiBase()}/api/users/${encodeURIComponent(walletAddress)}`,
    {
      method: "PUT",
      headers,
      body: JSON.stringify({ name, walletAddress }),
      cache: "no-store",
    }
  );
  return parseJson(res);
}

export async function confirmSolanaPayment({
  signature,
  walletAddress,
  purpose,
}) {
  let lastError = "Payment not confirmed yet.";
  for (let i = 0; i < 6; i++) {
    if (i > 0) await new Promise((r) => setTimeout(r, 1500 * i));
    const res = await fetch(`${apiBase()}/api/solana/payments/confirm`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ signature, walletAddress, purpose }),
      cache: "no-store",
    });
    const data = await res.json().catch(() => ({}));
    if (res.ok && data.ok) return data;
    lastError = data.error || lastError;
    if (data.code && data.code !== "NOT_CONFIRMED") {
      const err = new Error(data.error || lastError);
      err.code = data.code;
      throw err;
    }
  }
  throw new Error(lastError);
}

export function gamePlayUrl(gameId) {
  return `${apiBase()}/game/${encodeURIComponent(gameId)}`;
}

export function truncateAddress(address, left = 4, right = 4) {
  if (!address) return "";
  if (address.length <= left + right + 1) return address;
  return `${address.slice(0, left)}…${address.slice(-right)}`;
}
