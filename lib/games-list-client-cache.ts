import { Game } from "@/types";

const STORAGE_KEY = "arcadex_games_list_v1";
const SESSION_FRESH_KEY = "arcadex_games_list_fetched_at";

/** Background refresh interval for the home games list. */
export const GAMES_LIST_CLIENT_REFRESH_MS = 120_000;

export type CachedGamesPayload = {
  games: Game[];
  playCounts: Record<string, number>;
  fetchedAt: number;
};

function canUseSessionStorage(): boolean {
  return typeof window !== "undefined" && typeof sessionStorage !== "undefined";
}

export function readCachedGamesList(): CachedGamesPayload | null {
  if (!canUseSessionStorage()) return null;
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CachedGamesPayload;
    if (!Array.isArray(parsed.games)) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function writeCachedGamesList(payload: CachedGamesPayload): void {
  if (!canUseSessionStorage()) return;
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
    sessionStorage.setItem(SESSION_FRESH_KEY, String(payload.fetchedAt));
  } catch {
    // Storage quota or private mode — ignore.
  }
}

export function shouldBackgroundRefreshGamesList(): boolean {
  if (!canUseSessionStorage()) return true;
  try {
    const raw = sessionStorage.getItem(SESSION_FRESH_KEY);
    if (!raw) return true;
    const fetchedAt = Number(raw);
    if (!Number.isFinite(fetchedAt)) return true;
    return Date.now() - fetchedAt >= GAMES_LIST_CLIENT_REFRESH_MS;
  } catch {
    return true;
  }
}
