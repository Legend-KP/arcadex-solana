export const LEADERBOARD_MAX_ENTRIES = 25;
export const CONTEST_MAX_ENTRIES = 10;
export const CONTEST_DURATION_OPTIONS = [1, 2, 4, 7] as const;

export type ContestDurationDays = (typeof CONTEST_DURATION_OPTIONS)[number];
export type ContestStatus = "live" | "ended";

export interface LeaderboardEntry {
  name: string;
  score: number;
  walletAddress?: string;
  createdAt?: number;
}

export interface ContestInfo {
  status: ContestStatus;
  task: string;
  startedAt: number;
  endsAt: number;
  durationDays: ContestDurationDays;
  entries: LeaderboardEntry[];
}

export interface PlayerProfile {
  id: string;
  name: string;
  walletAddress?: string;
  createdAt: number;
  updatedAt: number;
}

/** Gating fields mirrored for hot-path reads (`gameFlags/{id}` on RTDB, `game_flags` on D1). */
export interface GameGatingFlags {
  active: boolean;
  live: boolean;
  hasLeaderboard: boolean;
  contestLive?: boolean;
  contestDurationDays?: ContestDurationDays;
  contestTask?: string;
  contestStartedAt?: number;
  contestEndsAt?: number;
}

export interface Game {
  id: string;
  name: string;
  thumbnail: string;   // image URL
  logo?: string;       // square 1:1 logo URL (menu screen)
  url: string;         // Unity WebGL URL
  plays: string;       // display string e.g. "1.2m"
  fallbackImage: string; // image URL when thumbnail/logo are missing
  active: boolean;
  /** When false, the game is visible but shows "Coming Soon" and cannot be played. Defaults to true. */
  live?: boolean;
  /** When false, this is a level game: no leaderboard UI; progress is stored as `l`. Defaults to true (score game, stores `s`). */
  hasLeaderboard?: boolean;
  /** Legacy flag; live status is derived from contestEndsAt. */
  contestLive?: boolean;
  /** Contest duration in days (1, 2, 4, or 7). */
  contestDurationDays?: ContestDurationDays;
  /** Admin-defined task text shown on the leaderboard during a contest. */
  contestTask?: string;
  /** Unix ms timestamp when the current contest started. */
  contestStartedAt?: number;
  /** Unix ms timestamp when the current contest ends. */
  contestEndsAt?: number;
  /** Display order on the home page (lower = earlier). Set via admin drag-and-drop. */
  sortOrder?: number;
  createdAt: number;
}

export function gameHasLeaderboard(game: Pick<Game, "hasLeaderboard">): boolean {
  return game.hasLeaderboard !== false;
}

export function gameIsLive(game: Pick<Game, "live">): boolean {
  return game.live !== false;
}

export function gameHasContestLive(
  game: Pick<Game, "contestStartedAt" | "contestEndsAt">
): boolean {
  const endsAt = game.contestEndsAt;
  if (typeof endsAt !== "number" || !Number.isFinite(endsAt)) return false;
  return endsAt > Date.now();
}

export function gameHasContestEnded(
  game: Pick<Game, "contestStartedAt" | "contestEndsAt">
): boolean {
  const startedAt = game.contestStartedAt;
  const endsAt = game.contestEndsAt;
  if (
    typeof startedAt !== "number" ||
    typeof endsAt !== "number" ||
    !Number.isFinite(startedAt) ||
    !Number.isFinite(endsAt)
  ) {
    return false;
  }
  return endsAt <= Date.now();
}

export function gameHasContest(
  game: Pick<Game, "contestStartedAt" | "contestEndsAt">
): boolean {
  return (
    typeof game.contestStartedAt === "number" &&
    typeof game.contestEndsAt === "number"
  );
}

/**
 * Raw RTDB shape at `users/{wallet}/games/{gameId}`.
 * Score games store `s`; level games store `l`.
 * Games like Coin Sort also store a checkpoint blob in `st` with revision `r`.
 */
export interface StoredGameProgress {
  /** High score (when hasLeaderboard is true) */
  s?: number;
  /** Current level (when hasLeaderboard is false) */
  l?: number;
  /** Opaque Unity checkpoint (stage, board, currency, milestones, …). */
  st?: Record<string, unknown>;
  /** Checkpoint revision for GAME_STATE_SAVE optimistic locking. */
  r?: number;
  /** @deprecated Legacy RTDB writes */
  score?: number;
  /** @deprecated Legacy RTDB writes */
  highScore?: number;
}

/**
 * Public leaderboard layout in RTDB:
 * - `leaderboards/{gameId}/entries/{wallet}` — full history
 * - `leaderboards/{gameId}/top/{wallet}` — small top-N mirror for hot reads
 * Contest boards mirror the same pattern under `contestLeaderboards/...`.
 */

/** API / client-facing game progress */
export interface GameProgress {
  score?: number;
  level?: number;
  /** Per-mode high levels (e.g. Line Link easy/medium/hard). */
  modes?: Record<string, number>;
}

/** Raw RTDB / D1 shape at `users/{wallet}/sparks`. */
export interface StoredSparkState {
  max: number;
  regenMs: number;
  /**
   * `null` = ready; number = ms timestamp when this slot becomes ready.
   * Timers are sequential: only one slot regenerates at a time; later empty
   * slots are chained at +regenMs after the previous slot's readyAt.
   */
  slots: (number | null)[];
  infiniteUntil?: number;
}

/** Per-slot view for UI (sequential regen queue). */
export interface SparkSlotView {
  index: number;
  /** `queued` = waiting for the previous Spark to finish regenerating. */
  status: "ready" | "regenerating" | "queued";
  fillPercent: number;
  timeRemainingMs: number;
}

/** Client-facing spark snapshot (computed each tick). */
export interface SparkSnapshot {
  max: number;
  available: number;
  fillPercent: number;
  timeToFullMs: number;
  timeToNextMs: number;
  slots: SparkSlotView[];
  regeneratingCount: number;
  hasInfinite: boolean;
  infiniteUntil?: number;
}
