/**
 * D1-backed player-data API — same signatures as lib/rtdb-server.ts.
 * Includes game gating flags + weekly activity when PLAYER_DATA_BACKEND=d1.
 */

import {
  GameProgress,
  GameGatingFlags,
  LEADERBOARD_MAX_ENTRIES,
  CONTEST_MAX_ENTRIES,
  LeaderboardEntry,
  PlayerProfile,
  StoredGameProgress,
  StoredSparkState,
} from "@/types";
import {
  SPARK_MAX,
  applySparkSpend,
  computeSparkSnapshot,
  defaultSparkState,
  normalizeSparkState,
} from "@/lib/spark";
import {
  d1BatchFirst,
  requireD1,
  type D1DatabaseLike,
  type D1PreparedStatement,
} from "@/lib/d1-client";
import { scheduleWorkerWork } from "@/lib/worker-context";
import {
  bumpCachedPlayCount,
  getCachedGameFlags,
  getCachedPlayCounts,
  invalidateGameFlagsCache,
  loadPlayCountsWithSharedCache,
  mergeCachedPlayCounts,
  schedulePlayCountsKvPersist,
  setCachedGameFlags,
} from "@/lib/rtdb-cache";
import { coalesceProgressWrite } from "@/lib/progress-write-coalesce";
import {
  extractModeLevels,
  modeLevelsToStoredState,
} from "@/lib/progress-value";
import {
  isWalletAddress,
  normalizeWalletAddress,
  tryNormalizeWalletAddress,
} from "@/lib/wallet-address";
import {
  ACTIVITY_LEADERBOARD_MAX_ENTRIES,
  ACTIVITY_PLAY_COOLDOWN_MS,
  ACTIVITY_TOP_MIRROR_SIZE,
  ActivityCounters,
  ActivityEventKind,
  ActivityLeaderboardEntry,
  coerceActivityCounters,
  compareActivityEntries,
  emptyActivityCounters,
  getIsoWeekWindow,
  utcDayKey,
  computeActivityXp,
  resolveActivityEntryXp,
} from "@/lib/activity-week";
import {
  GameStateConflictError,
  SparkSpendError,
  type GameStateRecord,
} from "@/lib/rtdb-server";
import { scrubSecrets } from "@/lib/firebase-admin";

type StoredUser = Omit<PlayerProfile, "id">;

const D1_TX_MAX_RETRIES = 8;

type SparksRow = {
  wallet: string;
  max: number;
  regen_ms: number;
  slots_json: string;
  infinite_until: number | null;
};

type ProgressRow = {
  wallet: string;
  game_id: string;
  s: number | null;
  l: number | null;
  st_json: string | null;
  r: number | null;
};

type LeaderboardRow = {
  game_id: string;
  player_key: string;
  name: string;
  score: number;
  wallet: string | null;
  created_at: number | null;
};


function resolveWalletField(
  id: string,
  walletAddress?: string
): string | undefined {
  const fromBody = tryNormalizeWalletAddress(walletAddress);
  if (fromBody) return fromBody;
  if (isWalletAddress(id)) return normalizeWalletAddress(id);
  return undefined;
}

function toPlayerProfile(id: string, data: StoredUser | null): PlayerProfile | null {
  if (!data) return null;
  return { id, ...data };
}

/** Ready slots stay null in D1 JSON (unlike RTDB's 0 sentinel). */
function sparkStateForD1(state: StoredSparkState): {
  max: number;
  regen_ms: number;
  slots_json: string;
  infinite_until: number | null;
} {
  return {
    max: state.max,
    regen_ms: state.regenMs,
    slots_json: JSON.stringify(state.slots),
    infinite_until: state.infiniteUntil ?? null,
  };
}

function sparksRowToState(row: SparksRow | null): StoredSparkState | null {
  if (!row) return null;
  let slots: unknown = [];
  try {
    slots = JSON.parse(row.slots_json);
  } catch {
    slots = [];
  }
  return normalizeSparkState({
    max: row.max,
    regenMs: row.regen_ms,
    slots,
    ...(row.infinite_until ? { infiniteUntil: row.infinite_until } : {}),
  });
}

async function readSparksRow(
  db: D1DatabaseLike,
  wallet: string
): Promise<SparksRow | null> {
  return db
    .prepare(
      `SELECT wallet, max, regen_ms, slots_json, infinite_until FROM sparks WHERE wallet = ?`
    )
    .bind(wallet)
    .first<SparksRow>();
}

async function writeSparksState(
  db: D1DatabaseLike,
  wallet: string,
  state: StoredSparkState
): Promise<void> {
  const packed = sparkStateForD1(state);
  await db
    .prepare(
      `INSERT INTO sparks (wallet, max, regen_ms, slots_json, infinite_until)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(wallet) DO UPDATE SET
         max = excluded.max,
         regen_ms = excluded.regen_ms,
         slots_json = excluded.slots_json,
         infinite_until = excluded.infinite_until`
    )
    .bind(
      wallet,
      packed.max,
      packed.regen_ms,
      packed.slots_json,
      packed.infinite_until
    )
    .run();
}

function progressRowToStored(row: ProgressRow | null): StoredGameProgress | null {
  if (!row) return null;
  const stored: StoredGameProgress = {};
  if (typeof row.s === "number") stored.s = row.s;
  if (typeof row.l === "number") stored.l = row.l;
  if (typeof row.r === "number") stored.r = row.r;
  if (row.st_json) {
    try {
      const st = JSON.parse(row.st_json) as unknown;
      if (st && typeof st === "object" && !Array.isArray(st)) {
        stored.st = st as Record<string, unknown>;
      }
    } catch {
      // ignore bad JSON
    }
  }
  return stored;
}

async function readProgressRow(
  db: D1DatabaseLike,
  wallet: string,
  gameId: string
): Promise<ProgressRow | null> {
  return db
    .prepare(
      `SELECT wallet, game_id, s, l, st_json, r FROM game_progress WHERE wallet = ? AND game_id = ?`
    )
    .bind(wallet, gameId)
    .first<ProgressRow>();
}

async function upsertProgressRow(
  db: D1DatabaseLike,
  wallet: string,
  gameId: string,
  stored: StoredGameProgress
): Promise<void> {
  const stJson =
    stored.st && typeof stored.st === "object"
      ? JSON.stringify(stored.st)
      : null;
  // COALESCE keeps the other field (s vs l, or st/r) when this write only
  // touches one progress path — matches RTDB merge behavior.
  await db
    .prepare(
      `INSERT INTO game_progress (wallet, game_id, s, l, st_json, r)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(wallet, game_id) DO UPDATE SET
         s = COALESCE(excluded.s, game_progress.s),
         l = COALESCE(excluded.l, game_progress.l),
         st_json = COALESCE(excluded.st_json, game_progress.st_json),
         r = COALESCE(excluded.r, game_progress.r)`
    )
    .bind(
      wallet,
      gameId,
      typeof stored.s === "number" ? stored.s : null,
      typeof stored.l === "number" ? stored.l : null,
      stJson,
      typeof stored.r === "number" ? stored.r : null
    )
    .run();
}

function leaderboardUserKey(entry: LeaderboardEntry): string {
  const wallet = tryNormalizeWalletAddress(entry.walletAddress);
  if (wallet) return `wallet:${wallet}`;
  return `name:${entry.name.trim().toLowerCase()}`;
}

function leaderboardStorageKey(entry: LeaderboardEntry): string {
  const wallet = tryNormalizeWalletAddress(entry.walletAddress);
  if (wallet) return wallet;
  return `name_${entry.name.trim().toLowerCase().replace(/[.#$[\]/]/g, "_")}`;
}

function rowToLeaderboardEntry(row: LeaderboardRow): LeaderboardEntry {
  return {
    name: row.name,
    score: row.score,
    ...(row.wallet ? { walletAddress: row.wallet } : {}),
    ...(typeof row.created_at === "number" ? { createdAt: row.created_at } : {}),
  };
}


// ─── Users ───────────────────────────────────────────────────────────────────

export async function fetchUserFromServer(
  id: string
): Promise<PlayerProfile | null> {
  const wallet = tryNormalizeWalletAddress(id);
  if (!wallet) return null;

  const db = await requireD1();
  const row = await db
    .prepare(
      `SELECT wallet, name, created_at, updated_at FROM users WHERE wallet = ?`
    )
    .bind(wallet)
    .first<{
      wallet: string;
      name: string;
      created_at: number;
      updated_at: number;
    }>();

  if (!row) return null;
  return toPlayerProfile(wallet, {
    name: row.name,
    walletAddress: row.wallet,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  });
}

export async function upsertUserOnServer(
  id: string,
  data: { name: string; walletAddress?: string }
): Promise<PlayerProfile> {
  const wallet = resolveWalletField(id, data.walletAddress);
  if (!wallet) {
    throw new Error("A wallet address is required to save a player profile.");
  }

  const existing = await fetchUserFromServer(wallet);
  const now = Date.now();
  const stored: StoredUser = {
    name: data.name.trim(),
    walletAddress: wallet,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  };

  const db = await requireD1();
  await db
    .prepare(
      `INSERT INTO users (wallet, name, created_at, updated_at)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(wallet) DO UPDATE SET
         name = excluded.name,
         updated_at = excluded.updated_at`
    )
    .bind(wallet, stored.name, stored.createdAt, stored.updatedAt)
    .run();

  return toPlayerProfile(wallet, stored)!;
}

export async function bootstrapUserOnServer(
  walletAddress: string
): Promise<PlayerProfile> {
  if (!isWalletAddress(walletAddress)) {
    throw new Error("bootstrap requires a valid wallet address.");
  }

  const wallet = normalizeWalletAddress(walletAddress);
  const existing = await fetchUserFromServer(wallet);

  if (!existing) {
    const now = Date.now();
    const stored: StoredUser = {
      name: "",
      walletAddress: wallet,
      createdAt: now,
      updatedAt: now,
    };
    const db = await requireD1();
    await db
      .prepare(
        `INSERT INTO users (wallet, name, created_at, updated_at) VALUES (?, ?, ?, ?)`
      )
      .bind(wallet, "", now, now)
      .run();
    await writeSparksState(db, wallet, defaultSparkState());
    return toPlayerProfile(wallet, stored)!;
  }

  await ensureSparkStateOnServer(wallet);
  return existing;
}

// ─── Sparks ───────────────────────────────────────────────────────────────────

export async function readSparkStateFromServer(
  walletAddress: string
): Promise<StoredSparkState> {
  if (!isWalletAddress(walletAddress)) {
    throw new Error("A valid wallet address is required.");
  }

  const wallet = normalizeWalletAddress(walletAddress);
  const db = await requireD1();
  const row = await readSparksRow(db, wallet);
  if (!row) return defaultSparkState();
  return sparksRowToState(row) ?? defaultSparkState();
}

/** One D1 round trip for home: users + sparks. */
export async function fetchHomePlayerFromServer(walletAddress: string): Promise<{
  user: PlayerProfile | null;
  state: StoredSparkState;
}> {
  const wallet = tryNormalizeWalletAddress(walletAddress);
  if (!wallet) {
    return { user: null, state: defaultSparkState() };
  }

  const db = await requireD1();
  const [userRes, sparkRes] = await db.batch([
    db
      .prepare(
        `SELECT wallet, name, created_at, updated_at FROM users WHERE wallet = ?`
      )
      .bind(wallet),
    db
      .prepare(
        `SELECT wallet, max, regen_ms, slots_json, infinite_until FROM sparks WHERE wallet = ?`
      )
      .bind(wallet),
  ]);

  const userRow = d1BatchFirst<{
    wallet: string;
    name: string;
    created_at: number;
    updated_at: number;
  }>(userRes);
  const sparkRow = d1BatchFirst<SparksRow>(sparkRes);

  return {
    user: userRow
      ? toPlayerProfile(wallet, {
          name: userRow.name,
          walletAddress: userRow.wallet,
          createdAt: userRow.created_at,
          updatedAt: userRow.updated_at,
        })
      : null,
    state: sparksRowToState(sparkRow) ?? defaultSparkState(),
  };
}

/** @deprecated Use readSparkStateFromServer — GET must not create rows. */
export async function fetchSparkStateFromServer(
  walletAddress: string
): Promise<StoredSparkState> {
  return readSparkStateFromServer(walletAddress);
}

export async function ensureSparkStateOnServer(
  walletAddress: string
): Promise<StoredSparkState> {
  const wallet = normalizeWalletAddress(walletAddress);
  const db = await requireD1();
  const existing = await readSparksRow(db, wallet);

  if (existing) {
    const normalized = sparksRowToState(existing)!;
    const packed = sparkStateForD1(normalized);
    const needsRewrite =
      existing.max < SPARK_MAX ||
      packed.slots_json !== existing.slots_json ||
      packed.regen_ms !== existing.regen_ms ||
      packed.infinite_until !== (existing.infinite_until ?? null);
    if (needsRewrite) {
      await writeSparksState(db, wallet, normalized);
    }
    return normalized;
  }

  const initial = defaultSparkState();
  await writeSparksState(db, wallet, initial);
  return initial;
}

export async function getSparkSnapshotFromServer(
  walletAddress: string
): Promise<ReturnType<typeof computeSparkSnapshot>> {
  const state = await readSparkStateFromServer(walletAddress);
  return computeSparkSnapshot(state);
}

export async function spendSparkOnServer(
  walletAddress: string
): Promise<{
  state: StoredSparkState;
  sparks: ReturnType<typeof computeSparkSnapshot>;
  spent: boolean;
}> {
  if (!isWalletAddress(walletAddress)) {
    throw new SparkSpendError(
      "A valid wallet address is required.",
      "NO_WALLET"
    );
  }

  const wallet = normalizeWalletAddress(walletAddress);
  const now = Date.now();
  const db = await requireD1();

  for (let attempt = 0; attempt < D1_TX_MAX_RETRIES; attempt++) {
    const row = await readSparksRow(db, wallet);
    const state = normalizeSparkState(
      sparksRowToState(row) ?? defaultSparkState(),
      now
    );

    if (state.infiniteUntil && state.infiniteUntil > now) {
      if (!row) await writeSparksState(db, wallet, state);
      recordActivityEventBestEffort(wallet, "play");
      return {
        state,
        sparks: computeSparkSnapshot(state),
        spent: false,
      };
    }

    const next = applySparkSpend(state, now);
    if (!next) {
      throw new SparkSpendError("No Sparks available.", "NO_SPARKS");
    }

    const packed = sparkStateForD1(next);

    if (!row) {
      await writeSparksState(db, wallet, next);
      recordActivityEventBestEffort(wallet, "play");
      return {
        state: next,
        sparks: computeSparkSnapshot(next),
        spent: true,
      };
    }

    const update = await db
      .prepare(
        `UPDATE sparks SET slots_json = ?, infinite_until = ?, max = ?, regen_ms = ?
         WHERE wallet = ? AND slots_json = ?`
      )
      .bind(
        packed.slots_json,
        packed.infinite_until,
        packed.max,
        packed.regen_ms,
        wallet,
        row.slots_json
      )
      .run();

    if (update.meta?.changes === 1) {
      recordActivityEventBestEffort(wallet, "play");
      return {
        state: next,
        sparks: computeSparkSnapshot(next),
        spent: true,
      };
    }
  }

  throw new Error("D1 spark spend failed after max retries.");
}


// ─── Game play counts ──────────────────────────────────────────────────────────

async function readAllPlayCounts(): Promise<Record<string, number>> {
  const db = await requireD1();
  const { results } = await db
    .prepare(`SELECT game_id, plays FROM game_plays`)
    .all<{ game_id: string; plays: number }>();

  const counts: Record<string, number> = {};
  for (const row of results ?? []) {
    if (typeof row.plays === "number" && Number.isFinite(row.plays)) {
      counts[row.game_id] = row.plays;
    }
  }
  return counts;
}

export async function fetchGamePlayCountsForIds(
  gameIds: string[]
): Promise<Record<string, number>> {
  const unique = [...new Set(gameIds.filter(Boolean))];
  if (unique.length === 0) return {};

  const cached = getCachedPlayCounts();
  if (cached && unique.every((id) => typeof cached[id] === "number")) {
    return Object.fromEntries(unique.map((id) => [id, cached[id]]));
  }

  const all = await loadPlayCountsWithSharedCache(readAllPlayCounts);
  return Object.fromEntries(
    unique.map((id) => [id, typeof all[id] === "number" ? all[id] : 0])
  );
}

/** @deprecated Prefer fetchGamePlayCountsForIds(catalogIds). */
export async function fetchAllGamePlayCounts(): Promise<Record<string, number>> {
  return loadPlayCountsWithSharedCache(readAllPlayCounts);
}

export async function fetchGamePlayCount(gameId: string): Promise<number> {
  const cached = getCachedPlayCounts();
  if (cached && typeof cached[gameId] === "number") {
    return cached[gameId];
  }

  const db = await requireD1();
  const row = await db
    .prepare(`SELECT plays FROM game_plays WHERE game_id = ?`)
    .bind(gameId)
    .first<{ plays: number }>();
  const value = typeof row?.plays === "number" ? row.plays : 0;
  mergeCachedPlayCounts({ [gameId]: value });
  return value;
}

export async function incrementGamePlayCount(gameId: string): Promise<number> {
  const db = await requireD1();
  await db
    .prepare(
      `INSERT INTO game_plays (game_id, plays) VALUES (?, 1)
       ON CONFLICT(game_id) DO UPDATE SET plays = plays + 1`
    )
    .bind(gameId)
    .run();

  const bumped = bumpCachedPlayCount(gameId, 1);
  schedulePlayCountsKvPersist();

  if (typeof bumped === "number") return bumped;
  return fetchGamePlayCount(gameId);
}

// ─── Leaderboard ─────────────────────────────────────────────────────────────

export async function fetchLeaderboardFromServer(
  gameId: string,
  limit = LEADERBOARD_MAX_ENTRIES
): Promise<LeaderboardEntry[]> {
  const db = await requireD1();
  const { results } = await db
    .prepare(
      `SELECT game_id, player_key, name, score, wallet, created_at
       FROM leaderboard_entries
       WHERE game_id = ?
       ORDER BY score DESC
       LIMIT ?`
    )
    .bind(gameId, Math.max(limit * 3, limit))
    .all<LeaderboardRow>();

  const best = new Map<string, LeaderboardEntry>();
  for (const row of results ?? []) {
    const entry = rowToLeaderboardEntry(row);
    const key = leaderboardUserKey(entry);
    const current = best.get(key);
    if (!current || entry.score > current.score) {
      best.set(key, entry);
    }
  }

  return Array.from(best.values())
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

export async function fetchUserSubmittedScoreFromServer(
  gameId: string,
  opts: { walletAddress?: string; playerName?: string }
): Promise<number> {
  const wallet = tryNormalizeWalletAddress(opts.walletAddress);
  const name = opts.playerName?.trim().toLowerCase();
  if (!wallet && !name) return 0;

  const db = await requireD1();

  if (wallet) {
    const row = await db
      .prepare(
        `SELECT score FROM leaderboard_entries WHERE game_id = ? AND player_key = ?`
      )
      .bind(gameId, wallet)
      .first<{ score: number }>();
    if (row && typeof row.score === "number") return row.score;
  }

  if (name) {
    const key = `name_${name.replace(/[.#$[\]/]/g, "_")}`;
    const row = await db
      .prepare(
        `SELECT score FROM leaderboard_entries WHERE game_id = ? AND player_key = ?`
      )
      .bind(gameId, key)
      .first<{ score: number }>();
    if (row && typeof row.score === "number") return row.score;
  }

  return 0;
}

/** @deprecated Use fetchUserSubmittedScoreFromServer */
export const fetchUserBestScoreFromServer = fetchUserSubmittedScoreFromServer;

export async function fetchPersonalBestFromServer(
  walletAddress: string,
  gameId: string
): Promise<number> {
  if (!isWalletAddress(walletAddress)) return 0;
  const stored = await fetchGameProgressFromServer(walletAddress, gameId);
  return readStoredScore(stored);
}

export async function submitLeaderboardEntryOnServer(
  gameId: string,
  entry: LeaderboardEntry
): Promise<void> {
  const wallet = tryNormalizeWalletAddress(entry.walletAddress);
  const payload: LeaderboardEntry = {
    name: entry.name,
    score: entry.score,
    ...(wallet ? { walletAddress: wallet } : {}),
    createdAt: entry.createdAt ?? Date.now(),
  };

  const storageKey = leaderboardStorageKey(payload);
  const db = await requireD1();
  const existing = await db
    .prepare(
      `SELECT score FROM leaderboard_entries WHERE game_id = ? AND player_key = ?`
    )
    .bind(gameId, storageKey)
    .first<{ score: number }>();

  if (
    existing &&
    typeof existing.score === "number" &&
    existing.score >= payload.score
  ) {
    return;
  }

  await db
    .prepare(
      `INSERT INTO leaderboard_entries (game_id, player_key, name, score, wallet, created_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(game_id, player_key) DO UPDATE SET
         name = excluded.name,
         score = excluded.score,
         wallet = excluded.wallet,
         created_at = excluded.created_at
       WHERE excluded.score > leaderboard_entries.score`
    )
    .bind(
      gameId,
      storageKey,
      payload.name,
      payload.score,
      wallet ?? null,
      payload.createdAt ?? null
    )
    .run();
}

export async function submitContestLeaderboardEntryOnServer(
  gameId: string,
  contestStartedAt: number,
  entry: LeaderboardEntry
): Promise<void> {
  const wallet = tryNormalizeWalletAddress(entry.walletAddress);
  if (!wallet) return;

  const payload: LeaderboardEntry = {
    name: entry.name,
    score: entry.score,
    walletAddress: wallet,
    createdAt: entry.createdAt ?? Date.now(),
  };

  const db = await requireD1();
  const existing = await db
    .prepare(
      `SELECT score FROM contest_entries
       WHERE game_id = ? AND contest_started_at = ? AND wallet = ?`
    )
    .bind(gameId, contestStartedAt, wallet)
    .first<{ score: number }>();

  if (
    existing &&
    typeof existing.score === "number" &&
    existing.score >= payload.score
  ) {
    return;
  }

  await db
    .prepare(
      `INSERT INTO contest_entries (game_id, contest_started_at, wallet, name, score, created_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(game_id, contest_started_at, wallet) DO UPDATE SET
         name = excluded.name,
         score = excluded.score,
         created_at = excluded.created_at
       WHERE excluded.score > contest_entries.score`
    )
    .bind(
      gameId,
      contestStartedAt,
      wallet,
      payload.name,
      payload.score,
      payload.createdAt ?? null
    )
    .run();
}

export async function fetchContestLeaderboardFromServer(
  gameId: string,
  contestStartedAt: number,
  limit = CONTEST_MAX_ENTRIES
): Promise<LeaderboardEntry[]> {
  const db = await requireD1();
  const { results } = await db
    .prepare(
      `SELECT game_id, wallet AS player_key, name, score, wallet, created_at
       FROM contest_entries
       WHERE game_id = ? AND contest_started_at = ?
       ORDER BY score DESC
       LIMIT ?`
    )
    .bind(gameId, contestStartedAt, limit)
    .all<LeaderboardRow>();

  return (results ?? []).map(rowToLeaderboardEntry);
}

// ─── Per-user game progress ───────────────────────────────────────────────────

export function readStoredScore(stored: StoredGameProgress | null): number {
  if (!stored) return 0;
  if (typeof stored.s === "number") return stored.s;
  if (typeof stored.score === "number") return stored.score;
  if (typeof stored.highScore === "number") return stored.highScore;
  return 0;
}

/**
 * Level column `l`, with fallback to `s` when older builds mis-routed
 * hasLeaderboard=false games into the score field.
 */
function readStoredLevel(stored: StoredGameProgress | null): number {
  if (!stored) return 0;
  if (typeof stored.l === "number" && Number.isFinite(stored.l) && stored.l > 0) {
    return stored.l;
  }
  if (typeof stored.s === "number" && Number.isFinite(stored.s) && stored.s > 0) {
    return stored.s;
  }
  if (typeof stored.l === "number" && Number.isFinite(stored.l)) {
    return stored.l;
  }
  return 0;
}

export function storedProgressToGameProgress(
  stored: StoredGameProgress | null,
  hasLeaderboard: boolean
): GameProgress {
  if (!stored) return {};

  const modes = readStoredModeLevels(stored);

  if (hasLeaderboard) {
    const score = readStoredScore(stored);
    return {
      ...(score > 0 ? { score } : {}),
      ...(modes ? { modes } : {}),
    };
  }

  const level =
    typeof stored.l === "number"
      ? stored.l
      : modes
        ? Math.max(0, ...Object.values(modes))
        : undefined;

  return {
    ...(level !== undefined ? { level } : {}),
    ...(modes ? { modes } : {}),
  };
}

function readStoredModeLevels(
  stored: StoredGameProgress | null
): Record<string, number> | undefined {
  const st = stored?.st;
  if (!st || typeof st !== "object" || Array.isArray(st)) return undefined;
  return extractModeLevels(st as Record<string, unknown>);
}

function mergeModeLevels(
  current: Record<string, number> | undefined,
  incoming: Record<string, number> | undefined
): Record<string, number> | undefined {
  if (!current && !incoming) return undefined;
  const next: Record<string, number> = { ...(current ?? {}) };
  if (incoming) {
    for (const [mode, level] of Object.entries(incoming)) {
      if (typeof level !== "number" || !Number.isFinite(level) || level < 0) {
        continue;
      }
      next[mode] = Math.max(next[mode] ?? 0, Math.floor(level));
    }
  }
  return Object.keys(next).length > 0 ? next : undefined;
}

function maxModeLevel(modes: Record<string, number> | undefined): number {
  if (!modes) return 0;
  let max = 0;
  for (const level of Object.values(modes)) {
    if (level > max) max = level;
  }
  return max;
}

export async function fetchGameProgressFromServer(
  walletAddress: string,
  gameId: string
): Promise<StoredGameProgress | null> {
  if (!isWalletAddress(walletAddress)) return null;
  const wallet = normalizeWalletAddress(walletAddress);
  const db = await requireD1();
  return progressRowToStored(await readProgressRow(db, wallet, gameId));
}

export async function resolveGameProgressFromServer(
  walletAddress: string,
  gameId: string,
  hasLeaderboard: boolean,
  _opts?: { playerName?: string }
): Promise<GameProgress> {
  if (!isWalletAddress(walletAddress)) return {};
  const stored = await fetchGameProgressFromServer(walletAddress, gameId);
  return storedProgressToGameProgress(stored, hasLeaderboard);
}


export async function saveGameProgressOnServer(
  walletAddress: string,
  gameId: string,
  value: number,
  hasLeaderboard: boolean,
  opts?: {
    playerName?: string;
    modes?: Record<string, number>;
    extras?: Record<string, unknown>;
  }
): Promise<GameProgress> {
  if (!isWalletAddress(walletAddress)) {
    throw new Error("A valid wallet address is required.");
  }
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    throw new Error("value must be a non-negative number.");
  }

  const wallet = normalizeWalletAddress(walletAddress);
  const incomingModes = opts?.modes;
  const incomingExtras = opts?.extras;

  return coalesceProgressWrite(
    wallet,
    gameId,
    value,
    async (batch) => {
      const field: "s" | "l" = hasLeaderboard ? "s" : "l";
      const modesToApply = batch.modes;
      const extrasToApply = batch.extras;
      const hasModes = Object.keys(modesToApply).length > 0;
      const hasExtras = Object.keys(extrasToApply).length > 0;
      const db = await requireD1();

      for (let attempt = 0; attempt < D1_TX_MAX_RETRIES; attempt++) {
        const current = progressRowToStored(
          await readProgressRow(db, wallet, gameId)
        );
        const currentValue = hasLeaderboard
          ? readStoredScore(current)
          : readStoredLevel(current);

        const mergedModes = mergeModeLevels(
          readStoredModeLevels(current),
          modesToApply
        );
        const modesMax = maxModeLevel(mergedModes);
        const nextScalar = Math.max(batch.value, modesMax);
        const scalarImproved = nextScalar > currentValue;

        const currentState = readStoredGameState(current) ?? {};
        const modeState = modeLevelsToStoredState(mergedModes);
        let nextState: Record<string, unknown> | undefined;
        let stateChanged = false;

        if (hasModes && modeState) {
          const prevModesJson = JSON.stringify(
            readStoredModeLevels(current) ?? null
          );
          const nextModesJson = JSON.stringify(mergedModes ?? null);
          if (prevModesJson !== nextModesJson) {
            nextState = {
              ...currentState,
              ...modeState,
            };
            stateChanged = true;
          }
        }

        if (hasExtras) {
          nextState = {
            ...(nextState ?? currentState),
            ...extrasToApply,
            ...(modeState ?? {}),
          };
          stateChanged = true;
        }

        if (!scalarImproved && !stateChanged && current) {
          if (
            !hasLeaderboard &&
            currentValue > 0 &&
            (typeof current.l !== "number" || current.l < currentValue)
          ) {
            const healed: StoredGameProgress = {
              ...current,
              l: currentValue,
            };
            await upsertProgressRow(db, wallet, gameId, healed);
            return storedProgressToGameProgress(healed, hasLeaderboard);
          }
          return storedProgressToGameProgress(current, hasLeaderboard);
        }

        if (nextScalar <= 0 && !current && !stateChanged) {
          return {};
        }

        const next: StoredGameProgress = { ...(current ?? {}) };
        if (
          scalarImproved ||
          (hasModes && !hasLeaderboard && nextScalar > 0)
        ) {
          next[field] = Math.max(currentValue, nextScalar);
        }
        if (nextState) {
          next.st = nextState;
          next.r = (typeof current?.r === "number" ? current.r : 0) + 1;
        }
        await upsertProgressRow(db, wallet, gameId, next);
        return storedProgressToGameProgress(next, hasLeaderboard);
      }

      const stored = await fetchGameProgressFromServer(wallet, gameId);
      return storedProgressToGameProgress(stored, hasLeaderboard);
    },
    { modes: incomingModes, extras: incomingExtras }
  );
}

const GAME_STATE_MAX_BYTES = 256 * 1024;
const UNSAFE_KEY = /[.$#[\]/]/;

function sanitizeGameStateValue(value: unknown, depth = 0): unknown {
  if (depth > 10) return null;
  if (value === null || value === undefined) return null;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    return value.length > 20_000 ? value.slice(0, 20_000) : value;
  }
  if (Array.isArray(value)) {
    return value
      .slice(0, 1000)
      .map((item) => sanitizeGameStateValue(item, depth + 1));
  }
  if (typeof value === "object") {
    const out: Record<string, unknown> = {};
    let count = 0;
    for (const [key, nested] of Object.entries(
      value as Record<string, unknown>
    )) {
      if (count >= 200) break;
      if (!key || UNSAFE_KEY.test(key)) continue;
      out[key] = sanitizeGameStateValue(nested, depth + 1);
      count += 1;
    }
    return out;
  }
  return null;
}

function sanitizeGameStateObject(state: unknown): Record<string, unknown> {
  const sanitized = sanitizeGameStateValue(state);
  if (!sanitized || typeof sanitized !== "object" || Array.isArray(sanitized)) {
    throw new Error("Game state must be a JSON object.");
  }
  const json = JSON.stringify(sanitized);
  if (json.length > GAME_STATE_MAX_BYTES) {
    throw new Error("Game state is too large.");
  }
  return sanitized as Record<string, unknown>;
}

function readStoredGameState(
  stored: StoredGameProgress | null
): Record<string, unknown> | null {
  if (!stored?.st || typeof stored.st !== "object" || Array.isArray(stored.st)) {
    return null;
  }
  return stored.st;
}

function readPositiveLevel(raw: unknown): number | null {
  if (typeof raw === "number" && Number.isFinite(raw) && raw > 0) {
    return Math.floor(raw);
  }
  if (typeof raw === "string" && raw.trim() !== "") {
    const parsed = Number(raw);
    if (Number.isFinite(parsed) && parsed > 0) return Math.floor(parsed);
  }
  return null;
}

/** Level games often put the unlocked level inside the checkpoint blob. */
function levelFromCheckpointState(
  state: Record<string, unknown> | null | undefined
): number | null {
  if (!state) return null;
  for (const key of ["level", "l", "currentLevel", "unlockedLevel"] as const) {
    const direct = readPositiveLevel(state[key]);
    if (direct != null) return direct;
  }
  for (const nestedKey of ["progress", "data", "save", "player"] as const) {
    const nested = state[nestedKey];
    if (!nested || typeof nested !== "object" || Array.isArray(nested)) continue;
    const obj = nested as Record<string, unknown>;
    for (const key of ["level", "l", "currentLevel", "unlockedLevel"] as const) {
      const found = readPositiveLevel(obj[key]);
      if (found != null) return found;
    }
  }
  return null;
}

export async function fetchGameStateFromServer(
  walletAddress: string,
  gameId: string
): Promise<GameStateRecord> {
  if (!isWalletAddress(walletAddress)) {
    return { found: false, revision: 0, state: null };
  }

  const stored = await fetchGameProgressFromServer(walletAddress, gameId);
  const state = readStoredGameState(stored);
  return {
    found: state != null && Object.keys(state).length > 0,
    revision: typeof stored?.r === "number" ? stored.r : 0,
    state,
  };
}

export async function saveGameStateOnServer(
  walletAddress: string,
  gameId: string,
  state: unknown,
  opts?: { baseRevision?: number; merge?: boolean }
): Promise<GameStateRecord> {
  if (!isWalletAddress(walletAddress)) {
    throw new Error("A valid wallet address is required.");
  }

  const incoming = sanitizeGameStateObject(state);
  const wallet = normalizeWalletAddress(walletAddress);
  const db = await requireD1();
  const levelFromState = levelFromCheckpointState(incoming);

  for (let attempt = 0; attempt < D1_TX_MAX_RETRIES; attempt++) {
    const row = await readProgressRow(db, wallet, gameId);
    const current = progressRowToStored(row);
    const currentRevision = typeof current?.r === "number" ? current.r : 0;

    if (
      typeof opts?.baseRevision === "number" &&
      opts.baseRevision > 0 &&
      currentRevision > 0 &&
      opts.baseRevision !== currentRevision
    ) {
      throw new GameStateConflictError(
        currentRevision,
        readStoredGameState(current)
      );
    }

    const currentState = readStoredGameState(current) ?? {};
    const nextState = opts?.merge
      ? { ...currentState, ...incoming }
      : incoming;

    const currentLevel = readStoredLevel(current);
    const nextLevel =
      levelFromState != null && levelFromState > currentLevel
        ? levelFromState
        : currentLevel > 0
          ? currentLevel
          : undefined;

    const next: StoredGameProgress = {
      ...(current ?? {}),
      st: nextState,
      r: currentRevision + 1,
      ...(typeof nextLevel === "number" ? { l: nextLevel } : {}),
    };

    if (row) {
      // COALESCE so a state-only write never nulls out s/l.
      const update = await db
        .prepare(
          `UPDATE game_progress
           SET st_json = ?, r = ?,
               s = COALESCE(?, s),
               l = COALESCE(?, l)
           WHERE wallet = ? AND game_id = ? AND IFNULL(r, 0) = ?`
        )
        .bind(
          JSON.stringify(nextState),
          next.r ?? null,
          typeof next.s === "number" ? next.s : null,
          typeof next.l === "number" ? next.l : null,
          wallet,
          gameId,
          currentRevision
        )
        .run();

      if (update.meta?.changes !== 1) continue;
    } else {
      await upsertProgressRow(db, wallet, gameId, next);
    }

    return {
      found: true,
      revision: typeof next.r === "number" ? next.r : 1,
      state: nextState,
    };
  }

  const latest = await fetchGameStateFromServer(wallet, gameId);
  throw new GameStateConflictError(latest.revision, latest.state);
}


// ─── Game gating flags (Firestore mirror for hot paths) ───────────────────────

type GameFlagsRow = {
  game_id: string;
  active: number;
  live: number;
  has_leaderboard: number;
  contest_live: number;
  contest_duration_days: number | null;
  contest_task: string | null;
  contest_started_at: number | null;
  contest_ends_at: number | null;
};

function rowToGameFlags(row: GameFlagsRow): GameGatingFlags {
  return {
    active: row.active !== 0,
    live: row.live !== 0,
    hasLeaderboard: row.has_leaderboard !== 0,
    contestLive: row.contest_live !== 0,
    contestDurationDays:
      typeof row.contest_duration_days === "number"
        ? (row.contest_duration_days as GameGatingFlags["contestDurationDays"])
        : undefined,
    contestTask: row.contest_task ?? undefined,
    contestStartedAt:
      typeof row.contest_started_at === "number"
        ? row.contest_started_at
        : undefined,
    contestEndsAt:
      typeof row.contest_ends_at === "number" ? row.contest_ends_at : undefined,
  };
}

export async function fetchGameGatingFlagsFromRtdb(
  gameId: string
): Promise<GameGatingFlags | null> {
  const cached = getCachedGameFlags(gameId);
  if (cached) return cached;

  const db = await requireD1();
  const row = await db
    .prepare(
      `SELECT game_id, active, live, has_leaderboard, contest_live,
              contest_duration_days, contest_task, contest_started_at, contest_ends_at
       FROM game_flags WHERE game_id = ?`
    )
    .bind(gameId)
    .first<GameFlagsRow>();

  if (!row) return null;
  const flags = rowToGameFlags(row);
  setCachedGameFlags(gameId, flags);
  return flags;
}

export async function syncGameGatingFlagsToRtdb(
  gameId: string,
  flags: GameGatingFlags
): Promise<void> {
  const db = await requireD1();
  await db
    .prepare(
      `INSERT INTO game_flags (
         game_id, active, live, has_leaderboard, contest_live,
         contest_duration_days, contest_task, contest_started_at, contest_ends_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(game_id) DO UPDATE SET
         active = excluded.active,
         live = excluded.live,
         has_leaderboard = excluded.has_leaderboard,
         contest_live = excluded.contest_live,
         contest_duration_days = excluded.contest_duration_days,
         contest_task = excluded.contest_task,
         contest_started_at = excluded.contest_started_at,
         contest_ends_at = excluded.contest_ends_at`
    )
    .bind(
      gameId,
      flags.active !== false ? 1 : 0,
      flags.live !== false ? 1 : 0,
      flags.hasLeaderboard !== false ? 1 : 0,
      flags.contestLive === true ? 1 : 0,
      typeof flags.contestDurationDays === "number"
        ? flags.contestDurationDays
        : null,
      flags.contestTask ?? null,
      typeof flags.contestStartedAt === "number" ? flags.contestStartedAt : null,
      typeof flags.contestEndsAt === "number" ? flags.contestEndsAt : null
    )
    .run();
  setCachedGameFlags(gameId, flags);
}

export async function deleteGameGatingFlagsFromRtdb(
  gameId: string
): Promise<void> {
  const db = await requireD1();
  await db
    .prepare(`DELETE FROM game_flags WHERE game_id = ?`)
    .bind(gameId)
    .run();
  invalidateGameFlagsCache(gameId);
}

export async function listGameGatingFlagIds(): Promise<string[]> {
  const db = await requireD1();
  const { results } = await db
    .prepare(`SELECT game_id FROM game_flags`)
    .all<{ game_id: string }>();
  return (results ?? []).map((r) => r.game_id);
}

// ─── Weekly activity leaderboard ─────────────────────────────────────────────

type ActivityRow = {
  wallet: string;
  week_id: string;
  sparks_spent: number;
  active_days: number;
  txs: number;
  spend_units: number;
  last_active_day: string | null;
  last_play_at: number | null;
  updated_at: number | null;
  name: string | null;
};

type ActivityLbRow = {
  week_id: string;
  wallet: string;
  name: string;
  score: number;
  sparks_spent: number;
  active_days: number;
  txs: number;
  spend_units: number;
  updated_at: number | null;
};

function activityRowToCounters(row: ActivityRow | null): ActivityCounters {
  if (!row) return emptyActivityCounters();
  return coerceActivityCounters({
    sparksSpent: row.sparks_spent,
    activeDays: row.active_days,
    txs: row.txs,
    spendUnits: row.spend_units,
    lastActiveDay: row.last_active_day ?? undefined,
    lastPlayAt: row.last_play_at ?? undefined,
    updatedAt: row.updated_at ?? undefined,
    name: row.name ?? undefined,
  });
}

function activityEntryFromCounters(
  wallet: string,
  counters: ActivityCounters
): ActivityLeaderboardEntry {
  return {
    name: counters.name?.trim() || "Player",
    score: computeActivityXp(counters),
    walletAddress: normalizeWalletAddress(wallet),
    sparksSpent: counters.sparksSpent,
    activeDays: counters.activeDays,
    txs: counters.txs,
    spendUnits: counters.spendUnits,
    updatedAt: counters.updatedAt,
  };
}

function lbRowToEntry(row: ActivityLbRow): ActivityLeaderboardEntry {
  return resolveActivityEntryXp({
    name: row.name,
    score: row.score,
    walletAddress: normalizeWalletAddress(row.wallet),
    sparksSpent: row.sparks_spent,
    activeDays: row.active_days,
    txs: row.txs,
    spendUnits: row.spend_units,
    updatedAt: row.updated_at ?? undefined,
  });
}

function activityCountersStatement(
  db: D1DatabaseLike,
  wallet: string,
  weekId: string,
  counters: ActivityCounters
): D1PreparedStatement {
  return db
    .prepare(
      `INSERT INTO user_activity (
         wallet, week_id, sparks_spent, active_days, txs, spend_units,
         last_active_day, last_play_at, updated_at, name
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(wallet, week_id) DO UPDATE SET
         sparks_spent = excluded.sparks_spent,
         active_days = excluded.active_days,
         txs = excluded.txs,
         spend_units = excluded.spend_units,
         last_active_day = excluded.last_active_day,
         last_play_at = excluded.last_play_at,
         updated_at = excluded.updated_at,
         name = excluded.name`
    )
    .bind(
      wallet,
      weekId,
      counters.sparksSpent,
      counters.activeDays,
      counters.txs,
      counters.spendUnits,
      counters.lastActiveDay ?? null,
      counters.lastPlayAt ?? null,
      counters.updatedAt ?? null,
      counters.name ?? null
    );
}

function activityLeaderboardStatement(
  db: D1DatabaseLike,
  weekId: string,
  entry: ActivityLeaderboardEntry
): D1PreparedStatement {
  const wallet = normalizeWalletAddress(entry.walletAddress);
  return db
    .prepare(
      `INSERT INTO activity_leaderboard_entries (
         week_id, wallet, name, score, sparks_spent, active_days, txs, spend_units, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(week_id, wallet) DO UPDATE SET
         name = excluded.name,
         score = excluded.score,
         sparks_spent = excluded.sparks_spent,
         active_days = excluded.active_days,
         txs = excluded.txs,
         spend_units = excluded.spend_units,
         updated_at = excluded.updated_at`
    )
    .bind(
      weekId,
      wallet,
      entry.name,
      entry.score,
      entry.sparksSpent ?? 0,
      entry.activeDays ?? 0,
      entry.txs ?? 0,
      entry.spendUnits ?? 0,
      entry.updatedAt ?? null
    );
}

/**
 * Best-effort activity bump. Never throws to callers — log and swallow.
 * `spendUnits` only applies when kind is "spend".
 */
export async function recordActivityEvent(
  walletAddress: string,
  kind: ActivityEventKind,
  opts?: { spendUnits?: number; name?: string }
): Promise<void> {
  try {
    if (!isWalletAddress(walletAddress)) return;
    const wallet = normalizeWalletAddress(walletAddress);
    const now = Date.now();
    const { weekId } = getIsoWeekWindow(now);
    const day = utcDayKey(now);
    const spendUnits =
      kind === "spend" &&
      typeof opts?.spendUnits === "number" &&
      Number.isFinite(opts.spendUnits)
        ? Math.max(0, Math.floor(opts.spendUnits))
        : 0;

    const db = await requireD1();
    const profileNameOpt = opts?.name?.trim() || "";

    // One round trip: optional profile name + current week counters.
    const [userRes, activityRes] = await db.batch([
      db.prepare(`SELECT name FROM users WHERE wallet = ?`).bind(wallet),
      db
        .prepare(
          `SELECT wallet, week_id, sparks_spent, active_days, txs, spend_units,
                  last_active_day, last_play_at, updated_at, name
           FROM user_activity WHERE wallet = ? AND week_id = ?`
        )
        .bind(wallet, weekId),
    ]);

    const profileName =
      profileNameOpt ||
      String(d1BatchFirst<{ name: string }>(userRes)?.name ?? "").trim();

    const existing = activityRowToCounters(
      d1BatchFirst<ActivityRow>(activityRes)
    );
    const next: ActivityCounters = { ...existing };

    if (kind === "play") {
      if (
        typeof next.lastPlayAt === "number" &&
        now - next.lastPlayAt < ACTIVITY_PLAY_COOLDOWN_MS
      ) {
        return;
      }
      next.sparksSpent += 1;
      next.lastPlayAt = now;
    }

    if (
      kind === "tx" ||
      kind === "spend" ||
      kind === "play" ||
      kind === "visit"
    ) {
      if (next.lastActiveDay !== day) {
        next.activeDays += 1;
        next.lastActiveDay = day;
      }
    }

    if (kind === "tx" || kind === "spend") {
      next.txs += 1;
    }

    if (kind === "spend" && spendUnits > 0) {
      next.spendUnits += spendUnits;
    }

    if (profileName) next.name = profileName;
    next.updatedAt = now;

    if (
      kind === "visit" &&
      existing.lastActiveDay === day &&
      next.sparksSpent === existing.sparksSpent &&
      next.activeDays === existing.activeDays
    ) {
      return;
    }

    const writes: D1PreparedStatement[] = [
      activityCountersStatement(db, wallet, weekId, next),
    ];

    // Public board is sparks-first — don't list visit-only / 0-spark users.
    if (next.sparksSpent > 0) {
      writes.push(
        activityLeaderboardStatement(
          db,
          weekId,
          activityEntryFromCounters(wallet, next)
        )
      );
    }

    await db.batch(writes);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(
      `[ArcadeX][activity] recordActivityEvent failed: ${scrubSecrets(message)}`
    );
  }
}

/** Schedule activity after the response via waitUntil (Worker) / fire-and-forget (dev). */
export function recordActivityEventBestEffort(
  walletAddress: string,
  kind: ActivityEventKind,
  opts?: { spendUnits?: number; name?: string }
): void {
  scheduleWorkerWork(recordActivityEvent(walletAddress, kind, opts));
}

export async function fetchActivityLeaderboardFromServer(
  weekId: string,
  limit = ACTIVITY_LEADERBOARD_MAX_ENTRIES
): Promise<ActivityLeaderboardEntry[]> {
  const db = await requireD1();
  const { results } = await db
    .prepare(
      `SELECT week_id, wallet, name, score, sparks_spent, active_days, txs, spend_units, updated_at
       FROM activity_leaderboard_entries
       WHERE week_id = ? AND sparks_spent > 0
       ORDER BY score DESC, updated_at ASC
       LIMIT ?`
    )
    .bind(weekId, Math.max(limit, ACTIVITY_TOP_MIRROR_SIZE))
    .all<ActivityLbRow>();

  return (results ?? [])
    .map(lbRowToEntry)
    .sort(compareActivityEntries)
    .filter((e) => e.score > 0)
    .slice(0, limit);
}

export async function fetchUserActivityFromServer(
  walletAddress: string,
  weekId: string
): Promise<ActivityCounters> {
  if (!isWalletAddress(walletAddress)) return emptyActivityCounters();
  const wallet = normalizeWalletAddress(walletAddress);
  const db = await requireD1();
  const row = await db
    .prepare(
      `SELECT wallet, week_id, sparks_spent, active_days, txs, spend_units,
              last_active_day, last_play_at, updated_at, name
       FROM user_activity WHERE wallet = ? AND week_id = ?`
    )
    .bind(wallet, weekId)
    .first<ActivityRow>();
  return activityRowToCounters(row);
}
