const STORAGE_KEY = "arcadex_streak_broken_seen_v1";

type SeenMap = Record<string, string>;

function canUseStorage(): boolean {
  return typeof window !== "undefined" && typeof localStorage !== "undefined";
}

function breakKey(wallet: string, lastCheckInAt: number): string {
  return `${wallet.toLowerCase()}:${lastCheckInAt}`;
}

function readMap(): SeenMap {
  if (!canUseStorage()) return {};
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as SeenMap;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function writeMap(map: SeenMap): void {
  if (!canUseStorage()) return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(map));
  } catch {
    // Quota / private mode
  }
}

/** True if this broken-streak moment was already shown for this check-in gap. */
export function hasSeenStreakBroken(
  wallet: string,
  lastCheckInAt: number
): boolean {
  if (!wallet || !lastCheckInAt) return false;
  const map = readMap();
  return map[breakKey(wallet, lastCheckInAt)] === "1";
}

export function markStreakBrokenSeen(
  wallet: string,
  lastCheckInAt: number
): void {
  if (!wallet || !lastCheckInAt) return;
  const map = readMap();
  map[breakKey(wallet, lastCheckInAt)] = "1";

  // Keep storage small — drop oldest entries if the map grows.
  const keys = Object.keys(map);
  if (keys.length > 40) {
    for (const key of keys.slice(0, keys.length - 30)) {
      delete map[key];
    }
  }

  writeMap(map);
}
