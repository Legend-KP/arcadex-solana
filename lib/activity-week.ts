/** ISO week helpers + sparks-first ranking for the global activity board. */

const MS_PER_DAY = 24 * 60 * 60 * 1000;
export const ACTIVITY_PLAY_COOLDOWN_MS = 5_000;
export const ACTIVITY_LEADERBOARD_MAX_ENTRIES = 25;
export const ACTIVITY_TOP_MIRROR_SIZE = 50;

export type ActivityEventKind =
  | "play"
  | "visit"
  | "tx"
  | "spend";

export interface ActivityWeekWindow {
  weekId: string;
  startsAt: number;
  endsAt: number;
}

export interface ActivityCounters {
  sparksSpent: number;
  activeDays: number;
  txs: number;
  spendUnits: number;
  lastActiveDay?: string;
  lastPlayAt?: number;
  updatedAt?: number;
  name?: string;
}

export interface ActivityLeaderboardEntry {
  name: string;
  /** Display XP (composite — see computeActivityXp). */
  score: number;
  walletAddress: string;
  /** Plays counted this week (needed to recompute XP on read). */
  sparksSpent?: number;
  activeDays?: number;
  txs?: number;
  spendUnits?: number;
  updatedAt?: number;
}

/**
 * Simple XP shown on the board.
 * Plays dominate; active days and txs add enough that same-play totals don't look identical.
 * UI never explains these weights.
 */
export const ACTIVITY_XP_PER_PLAY = 10;
export const ACTIVITY_XP_PER_ACTIVE_DAY = 5;
export const ACTIVITY_XP_PER_TX = 1;
export const ACTIVITY_XP_PER_SPEND_UNIT = 1;

export function computeActivityXp(counters: Pick<
  ActivityCounters,
  "sparksSpent" | "activeDays" | "txs" | "spendUnits"
>): number {
  return (
    Math.max(0, counters.sparksSpent) * ACTIVITY_XP_PER_PLAY +
    Math.max(0, counters.activeDays) * ACTIVITY_XP_PER_ACTIVE_DAY +
    Math.max(0, counters.txs) * ACTIVITY_XP_PER_TX +
    Math.max(0, counters.spendUnits) * ACTIVITY_XP_PER_SPEND_UNIT
  );
}

/**
 * Normalize a stored board row to current XP.
 * Legacy rows used `score` as sparksSpent before the composite formula.
 */
export function resolveActivityEntryXp(
  entry: ActivityLeaderboardEntry
): ActivityLeaderboardEntry {
  const hasSparksField =
    typeof entry.sparksSpent === "number" && Number.isFinite(entry.sparksSpent);
  const sparksSpent = hasSparksField
    ? Math.max(0, Math.floor(entry.sparksSpent!))
    : Math.max(0, Math.floor(entry.score));
  const activeDays =
    typeof entry.activeDays === "number" ? Math.max(0, entry.activeDays) : 0;
  const txs = typeof entry.txs === "number" ? Math.max(0, entry.txs) : 0;
  const spendUnits =
    typeof entry.spendUnits === "number" ? Math.max(0, entry.spendUnits) : 0;

  return {
    ...entry,
    sparksSpent,
    activeDays,
    txs,
    spendUnits,
    score: computeActivityXp({ sparksSpent, activeDays, txs, spendUnits }),
  };
}

/** Monday 00:00 UTC of the ISO week containing `now`. */
export function getIsoWeekWindow(now = Date.now()): ActivityWeekWindow {
  const d = new Date(now);
  const utc = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  const day = new Date(utc).getUTCDay(); // 0 Sun … 6 Sat
  const daysFromMonday = (day + 6) % 7;
  const startsAt = utc - daysFromMonday * MS_PER_DAY;
  const endsAt = startsAt + 7 * MS_PER_DAY;
  return {
    weekId: isoWeekIdFromMondayUtc(startsAt),
    startsAt,
    endsAt,
  };
}

export function getPreviousIsoWeekWindow(now = Date.now()): ActivityWeekWindow {
  const current = getIsoWeekWindow(now);
  return getIsoWeekWindow(current.startsAt - 1);
}

function isoWeekIdFromMondayUtc(mondayUtcMs: number): string {
  const monday = new Date(mondayUtcMs);
  // ISO week year is the year of the Thursday of this week.
  const thursday = new Date(mondayUtcMs + 3 * MS_PER_DAY);
  const weekYear = thursday.getUTCFullYear();
  const jan4 = Date.UTC(weekYear, 0, 4);
  const jan4Day = new Date(jan4).getUTCDay();
  const jan4Monday = jan4 - ((jan4Day + 6) % 7) * MS_PER_DAY;
  const week = Math.floor((mondayUtcMs - jan4Monday) / (7 * MS_PER_DAY)) + 1;
  return `${weekYear}-W${String(week).padStart(2, "0")}`;
}

export function utcDayKey(now = Date.now()): string {
  return new Date(now).toISOString().slice(0, 10);
}

export function emptyActivityCounters(): ActivityCounters {
  return {
    sparksSpent: 0,
    activeDays: 0,
    txs: 0,
    spendUnits: 0,
  };
}

export function coerceActivityCounters(raw: unknown): ActivityCounters {
  const base = emptyActivityCounters();
  if (!raw || typeof raw !== "object") return base;
  const data = raw as Partial<ActivityCounters>;
  return {
    sparksSpent:
      typeof data.sparksSpent === "number" && Number.isFinite(data.sparksSpent)
        ? Math.max(0, Math.floor(data.sparksSpent))
        : 0,
    activeDays:
      typeof data.activeDays === "number" && Number.isFinite(data.activeDays)
        ? Math.max(0, Math.floor(data.activeDays))
        : 0,
    txs:
      typeof data.txs === "number" && Number.isFinite(data.txs)
        ? Math.max(0, Math.floor(data.txs))
        : 0,
    spendUnits:
      typeof data.spendUnits === "number" && Number.isFinite(data.spendUnits)
        ? Math.max(0, Math.floor(data.spendUnits))
        : 0,
    lastActiveDay:
      typeof data.lastActiveDay === "string" ? data.lastActiveDay : undefined,
    lastPlayAt:
      typeof data.lastPlayAt === "number" && Number.isFinite(data.lastPlayAt)
        ? data.lastPlayAt
        : undefined,
    updatedAt:
      typeof data.updatedAt === "number" && Number.isFinite(data.updatedAt)
        ? data.updatedAt
        : undefined,
    name: typeof data.name === "string" ? data.name : undefined,
  };
}

/** Higher XP first; earlier updatedAt breaks remaining ties. */
export function compareActivityEntries(
  a: ActivityLeaderboardEntry,
  b: ActivityLeaderboardEntry
): number {
  if (b.score !== a.score) return b.score - a.score;
  const aUpdated = a.updatedAt ?? Number.MAX_SAFE_INTEGER;
  const bUpdated = b.updatedAt ?? Number.MAX_SAFE_INTEGER;
  if (aUpdated !== bUpdated) return aUpdated - bUpdated;
  return (a.walletAddress || "").localeCompare(b.walletAddress || "");
}

export function formatActivityCountdown(remainingMs: number): string {
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
