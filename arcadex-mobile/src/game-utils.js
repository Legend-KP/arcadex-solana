import AsyncStorage from "@react-native-async-storage/async-storage";

const RECENT_KEY = "arcadex_recent_plays";
const NEW_ARRIVAL_MS = 14 * 24 * 60 * 60 * 1000;

export function formatPlayCount(count) {
  const n = Math.max(0, Math.floor(Number(count) || 0));
  if (n < 1000) return String(n);
  if (n < 1_000_000) return `${(n / 1000).toFixed(1)}k`;
  return `${(n / 1_000_000).toFixed(1)}m`;
}

export function formatContestCountdown(remainingMs) {
  const totalSeconds = Math.max(0, Math.floor(remainingMs / 1000));
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (days > 0) {
    return `${days}d ${String(hours).padStart(2, "0")}h ${String(minutes).padStart(2, "0")}m left`;
  }
  if (hours > 0) {
    return `${hours}h ${String(minutes).padStart(2, "0")}m ${String(seconds).padStart(2, "0")}s left`;
  }
  return `${minutes}m ${String(seconds).padStart(2, "0")}s left`;
}

export function gameIsLive(game) {
  return game?.live !== false;
}

export function gameHasContestLive(game, now = Date.now()) {
  const endsAt = game?.contestEndsAt;
  return typeof endsAt === "number" && Number.isFinite(endsAt) && endsAt > now;
}

export function isNewArrival(game, now = Date.now()) {
  const created = Number(game?.createdAt);
  if (!Number.isFinite(created) || created <= 0) return false;
  return now - created < NEW_ARRIVAL_MS;
}

export function sortGames(games, mode = "default") {
  const list = [...(games || [])];
  if (mode === "name") {
    return list.sort((a, b) =>
      String(a.name || "").localeCompare(String(b.name || ""))
    );
  }
  if (mode === "plays") {
    return list.sort(
      (a, b) => (Number(b._plays) || 0) - (Number(a._plays) || 0)
    );
  }
  if (mode === "newest") {
    return list.sort(
      (a, b) => (Number(b.createdAt) || 0) - (Number(a.createdAt) || 0)
    );
  }
  return list.sort((a, b) => {
    const ao = typeof a.sortOrder === "number" ? a.sortOrder : 9999;
    const bo = typeof b.sortOrder === "number" ? b.sortOrder : 9999;
    if (ao !== bo) return ao - bo;
    return (Number(b.createdAt) || 0) - (Number(a.createdAt) || 0);
  });
}

export async function readRecentPlayIds() {
  try {
    const raw = await AsyncStorage.getItem(RECENT_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter((x) => typeof x === "string") : [];
  } catch {
    return [];
  }
}

export async function pushRecentPlayId(gameId) {
  if (!gameId) return;
  const prev = await readRecentPlayIds();
  const next = [gameId, ...prev.filter((id) => id !== gameId)].slice(0, 12);
  await AsyncStorage.setItem(RECENT_KEY, JSON.stringify(next));
}
