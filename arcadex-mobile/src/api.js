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

export async function fetchActivityLeaderboard(walletAddress) {
  const params = new URLSearchParams();
  if (walletAddress) params.set("wallet", walletAddress);
  params.set("week", "current");
  const qs = params.toString();
  const res = await fetch(
    `${apiBase()}/api/leaderboard/activity${qs ? `?${qs}` : ""}`,
    { cache: "no-store" }
  );
  const data = await parseJson(res);
  const entries = Array.isArray(data.entries) ? data.entries : [];
  return {
    weekId: data.weekId || "",
    startsAt: data.startsAt ?? 0,
    endsAt: data.endsAt ?? 0,
    endsAtMs: data.endsAtMs ?? data.endsAt ?? 0,
    resetsIn: data.resetsIn ?? null,
    entries,
    totalParticipants: Math.max(
      Number(data.totalParticipants ?? 0) || 0,
      entries.length
    ),
    me: data.me ?? null,
  };
}

export function formatActivityCountdown(remainingMs) {
  const totalSeconds = Math.max(0, Math.floor(remainingMs / 1000));
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (days > 0) {
    return `${days}d ${String(hours).padStart(2, "0")}h ${String(minutes).padStart(2, "0")}m`;
  }
  if (hours > 0) {
    return `${hours}h ${String(minutes).padStart(2, "0")}m ${String(seconds).padStart(2, "0")}s`;
  }
  return `${minutes}m ${String(seconds).padStart(2, "0")}s`;
}

export function logoUrl() {
  return `${apiBase()}/logo.png`;
}

export function logoFallbackUrl() {
  return `${apiBase()}/logo.png`;
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

export function dailyShuffleUrl() {
  // Host route still used by the native overlay; UI is Daily Streak when mode=streak.
  return `${apiBase()}/daily-shuffle`;
}

function utcDayKey(now = Date.now()) {
  return new Date(now).toISOString().slice(0, 10);
}

function streakPromptedKey(walletAddress, campaignId = 1) {
  return `arcadex_streak_prompted_utc:${String(walletAddress).trim()}:${campaignId}`;
}

/** True if we already auto-opened Daily Streak for this wallet on today's UTC day. */
export async function hasStreakPromptedToday(walletAddress, campaignId = 1) {
  if (!walletAddress) return false;
  try {
    const AsyncStorage = (
      await import("@react-native-async-storage/async-storage")
    ).default;
    const raw = await AsyncStorage.getItem(
      streakPromptedKey(walletAddress, campaignId)
    );
    return raw === utcDayKey();
  } catch {
    return false;
  }
}

export async function markStreakPromptedToday(walletAddress, campaignId = 1) {
  if (!walletAddress) return;
  try {
    const AsyncStorage = (
      await import("@react-native-async-storage/async-storage")
    ).default;
    await AsyncStorage.setItem(
      streakPromptedKey(walletAddress, campaignId),
      utcDayKey()
    );
  } catch {
    // ignore
  }
}

/** Returns true when the wallet can still do today's Daily Streak check-in. */
export async function fetchShuffleCanCheckIn(walletAddress, campaignId = 1) {
  if (!walletAddress) return false;
  const params = new URLSearchParams({
    walletAddress,
    campaignId: String(campaignId),
  });
  const res = await fetch(`${apiBase()}/api/streak/status?${params}`, {
    cache: "no-store",
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) return false;
  return Boolean(data.canCheckIn);
}

export function truncateAddress(address, left = 4, right = 4) {
  if (!address) return "";
  if (address.length <= left + right + 1) return address;
  return `${address.slice(0, left)}…${address.slice(-right)}`;
}
