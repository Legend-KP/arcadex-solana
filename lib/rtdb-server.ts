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
  coerceSparkState,
  defaultSparkState,
  normalizeSparkState,
  sparkStateForRtdb,
} from "@/lib/spark";
import { getDatabaseUrl, getFirebaseAccessToken, scrubSecrets } from "./firebase-admin";
import { fetchWithTimeout } from "@/lib/firebase-fetch";
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
  getPreviousIsoWeekWindow,
  utcDayKey,
  computeActivityXp,
  resolveActivityEntryXp,
} from "@/lib/activity-week";

type StoredUser = Omit<PlayerProfile, "id">;
type LeaderboardMap = Record<string, LeaderboardEntry>;

/** Extra slots in the top mirror so a near-miss doesn't thrash the cut line. */
const LEADERBOARD_TOP_MIRROR_SIZE = 50;
const CONTEST_TOP_MIRROR_SIZE = 15;
const RTDB_TRANSACTION_MAX_RETRIES = 8;

type RtdbFetchOptions = RequestInit & {
  /**
   * Suppress response body (reduces download bandwidth on writes).
   * Never combine with if-match / if-none-match — Firebase returns 400.
   */
  silent?: boolean;
  /** Return only immediate child keys (no nested payloads). */
  shallow?: boolean;
};

/** Service-account OAuth only; fail closed on auth errors. */
async function getRtdbAccessToken(): Promise<string> {
  try {
    return await getFirebaseAccessToken();
  } catch (oauthErr) {
    const message =
      oauthErr instanceof Error ? oauthErr.message : "OAuth token unavailable";
    console.error(
      `[ArcadeX][SECURITY][RTDB_AUTH] OAuth token acquisition failed: ${scrubSecrets(
        message
      )}`
    );
    throw new Error(
      `Realtime Database auth failed (${scrubSecrets(
        message
      )}). Configure FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL, FIREBASE_PRIVATE_KEY, and IAM access to Firebase RTDB.`
    );
  }
}

/** Encode each path segment for RTDB REST (wallet keys, game ids, etc.). */
function encodeRtdbPath(path: string): string {
  return path
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");
}

function profilePath(walletAddress: string): string {
  if (!isWalletAddress(walletAddress)) {
    throw new Error("User profile requires a valid wallet address.");
  }
  return `users/${normalizeWalletAddress(walletAddress)}`;
}

function sparksPath(walletAddress: string): string {
  return `${profilePath(walletAddress)}/sparks`;
}

function resolveWalletField(
  id: string,
  walletAddress?: string
): string | undefined {
  const fromBody = tryNormalizeWalletAddress(walletAddress);
  if (fromBody) return fromBody;
  if (isWalletAddress(id)) return normalizeWalletAddress(id);
  return undefined;
}

/**
 * RTDB REST with Bearer auth (token stays out of the URL / access logs).
 * Optional print=silent and shallow query flags.
 */
async function rtdbFetch(
  path: string,
  init?: RtdbFetchOptions
): Promise<Response> {
  const token = await getRtdbAccessToken();
  const { silent, shallow, headers: initHeaders, ...rest } = init ?? {};

  const params = new URLSearchParams();
  if (silent) params.set("print", "silent");
  if (shallow) params.set("shallow", "true");
  const qs = params.toString();

  const url = `${getDatabaseUrl()}/${encodeRtdbPath(path)}.json${
    qs ? `?${qs}` : ""
  }`;

  return fetchWithTimeout(url, {
    ...rest,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(rest.body ? { "Content-Type": "application/json" } : {}),
      ...initHeaders,
    },
  });
}

async function readPath<T>(path: string): Promise<T | null> {
  const res = await rtdbFetch(path);
  if (res.status === 404) return null;
  if (!res.ok) {
    const text = scrubSecrets(await res.text());
    throw new Error(`Realtime Database read failed (${res.status}): ${text}`);
  }

  const data = (await res.json()) as T | null;
  return data ?? null;
}

/** Immediate child keys only — no nested payloads. */
export async function readPathShallow(
  path: string
): Promise<Record<string, boolean> | null> {
  const res = await rtdbFetch(path, { shallow: true });
  if (res.status === 404) return null;
  if (!res.ok) {
    const text = scrubSecrets(await res.text());
    throw new Error(`Realtime Database shallow read failed (${res.status}): ${text}`);
  }
  const data = (await res.json()) as Record<string, boolean> | null;
  return data ?? null;
}

/** GET with ETag for conditional writes (REST transactions). */
async function readPathWithEtag<T>(
  path: string
): Promise<{ data: T | null; etag: string }> {
  const res = await rtdbFetch(path, {
    headers: { "X-Firebase-ETag": "true" },
  });
  if (res.status === 404) {
    return { data: null, etag: res.headers.get("ETag") ?? '""' };
  }
  if (!res.ok) {
    const text = scrubSecrets(await res.text());
    throw new Error(`Realtime Database read failed (${res.status}): ${text}`);
  }

  const etag = res.headers.get("ETag");
  if (!etag) {
    throw new Error("Realtime Database ETag missing for transaction read.");
  }

  const data = (await res.json()) as T | null;
  return { data: data ?? null, etag };
}

async function writePath(path: string, data: unknown): Promise<void> {
  const res = await rtdbFetch(path, {
    method: "PUT",
    body: JSON.stringify(data),
    silent: true,
  });

  if (!res.ok) {
    const text = scrubSecrets(await res.text());
    throw new Error(`Realtime Database write failed (${res.status}): ${text}`);
  }
}

/** Partial update — only the provided fields are written. */
async function patchPath(path: string, data: unknown): Promise<void> {
  const res = await rtdbFetch(path, {
    method: "PATCH",
    body: JSON.stringify(data),
    silent: true,
  });

  if (!res.ok) {
    const text = scrubSecrets(await res.text());
    throw new Error(`Realtime Database patch failed (${res.status}): ${text}`);
  }
}

async function writePathIfMatch(
  path: string,
  data: unknown,
  etag: string
): Promise<"ok" | "conflict"> {
  // Do NOT use print=silent here — Firebase rejects mixing it with if-match.
  const res = await rtdbFetch(path, {
    method: "PUT",
    headers: { "if-match": etag },
    body: JSON.stringify(data),
  });

  if (res.status === 412) return "conflict";
  if (!res.ok) {
    const text = scrubSecrets(await res.text());
    throw new Error(`Realtime Database write failed (${res.status}): ${text}`);
  }
  return "ok";
}

async function deletePath(path: string): Promise<void> {
  const res = await rtdbFetch(path, { method: "DELETE", silent: true });
  if (!res.ok && res.status !== 404) {
    const text = scrubSecrets(await res.text());
    throw new Error(`Realtime Database delete failed (${res.status}): ${text}`);
  }
}

/** Atomic ServerValue.increment — no read-before-write race. */
async function incrementPath(path: string, delta = 1): Promise<void> {
  const res = await rtdbFetch(path, {
    method: "PUT",
    body: JSON.stringify({ ".sv": { increment: delta } }),
    silent: true,
  });

  if (!res.ok) {
    const text = scrubSecrets(await res.text());
    throw new Error(
      `Realtime Database increment failed (${res.status}): ${text}`
    );
  }
}

/**
 * Conditional write with automatic retry (RTDB REST transaction via ETag).
 * Return `undefined` from `updateFn` to abort without writing.
 */
async function runRtdbTransaction<T>(
  path: string,
  updateFn: (current: T | null) => T | undefined,
  maxRetries = RTDB_TRANSACTION_MAX_RETRIES
): Promise<{ committed: boolean; snapshot: T | null }> {
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    const { data, etag } = await readPathWithEtag<T>(path);
    const next = updateFn(data);
    if (next === undefined) {
      return { committed: false, snapshot: data };
    }

    const result = await writePathIfMatch(path, next, etag);
    if (result === "ok") {
      return { committed: true, snapshot: next };
    }
  }

  throw new Error("Realtime Database transaction failed after max retries.");
}

type GuardRecord = { wallet?: string } & Record<string, unknown>;

type GuardClaimResult<T extends GuardRecord> =
  | { status: "created"; record: T }
  | { status: "exists"; record: T }
  | { status: "conflict_other_wallet" };

/**
 * Atomically claim a one-time payment/reward guard.
 * Only one concurrent caller can create the marker for a given tx hash.
 */
async function claimGuardRecord<T extends GuardRecord>(
  path: string,
  wallet: string,
  buildRecord: () => T
): Promise<GuardClaimResult<T>> {
  let createdRecord: T | null = null;
  let existsRecord: T | null = null;
  let conflictOther = false;

  const { committed, snapshot } = await runRtdbTransaction<T>(path, (current) => {
    if (current?.wallet) {
      const recorded = normalizeWalletAddress(String(current.wallet));
      if (recorded === wallet) {
        existsRecord = current;
        return undefined;
      }
      conflictOther = true;
      return undefined;
    }

    const record = buildRecord();
    createdRecord = record;
    return record;
  });

  if (createdRecord && committed) {
    return { status: "created", record: createdRecord };
  }
  if (existsRecord) {
    return { status: "exists", record: existsRecord };
  }
  if (conflictOther) {
    return { status: "conflict_other_wallet" };
  }

  // Lost a create race — re-read winner.
  const existing = snapshot ?? (await readPath<T>(path));
  if (existing?.wallet) {
    const recorded = normalizeWalletAddress(String(existing.wallet));
    if (recorded === wallet) {
      return { status: "exists", record: existing };
    }
    return { status: "conflict_other_wallet" };
  }

  throw new Error("Failed to claim payment guard.");
}

function toPlayerProfile(id: string, data: StoredUser | null): PlayerProfile | null {
  if (!data) return null;
  return { id, ...data };
}

function mapToLeaderboardEntries(map: LeaderboardMap | null): LeaderboardEntry[] {
  if (!map) return [];
  const entries: LeaderboardEntry[] = [];
  for (const [key, value] of Object.entries(map)) {
    // Skip nested mirror/history containers if a parent node was read.
    if (key === "top" || key === "entries") continue;
    if (!value || typeof value !== "object") continue;
    if (typeof (value as LeaderboardEntry).score !== "number") continue;
    if (typeof (value as LeaderboardEntry).name !== "string") continue;
    entries.push(value as LeaderboardEntry);
  }
  return entries;
}

/** Stable identity for deduping — wallet preferred, name fallback. */
function leaderboardUserKey(entry: LeaderboardEntry): string {
  const wallet = tryNormalizeWalletAddress(entry.walletAddress);
  if (wallet) return `wallet:${wallet}`;
  return `name:${entry.name.trim().toLowerCase()}`;
}

/** RTDB-safe key for per-user storage (wallet or sanitized name). */
function leaderboardStorageKey(entry: LeaderboardEntry): string {
  const wallet = tryNormalizeWalletAddress(entry.walletAddress);
  if (wallet) return wallet;
  return `name_${entry.name.trim().toLowerCase().replace(/[.#$[\]/]/g, "_")}`;
}

function deduplicateLeaderboardEntries(entries: LeaderboardEntry[]): LeaderboardEntry[] {
  const best = new Map<string, LeaderboardEntry>();
  for (const entry of entries) {
    const key = leaderboardUserKey(entry);
    const current = best.get(key);
    if (!current || entry.score > current.score) {
      best.set(key, entry);
    }
  }
  return Array.from(best.values());
}

// ─── Users ───────────────────────────────────────────────────────────────────

export async function fetchUserFromServer(
  id: string
): Promise<PlayerProfile | null> {
  const wallet = tryNormalizeWalletAddress(id);
  if (!wallet) return null;

  const data = await readPath<StoredUser>(profilePath(wallet));
  if (!data) return null;
  return toPlayerProfile(wallet, data);
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

  await writePath(profilePath(wallet), stored);
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
    await writePath(`users/${wallet}`, stored);
    await writePath(sparksPath(wallet), sparkStateForRtdb(defaultSparkState()));
    return toPlayerProfile(wallet, stored)!;
  }

  await ensureSparkStateOnServer(wallet);
  return existing;
}

// ─── Sparks ───────────────────────────────────────────────────────────────────

/**
 * Read-only spark lookup. Missing wallets get the default full battery
 * in memory — no RTDB row is created. Persist via bootstrap or spend.
 */
export async function readSparkStateFromServer(
  walletAddress: string
): Promise<StoredSparkState> {
  if (!isWalletAddress(walletAddress)) {
    throw new Error("A valid wallet address is required.");
  }

  const wallet = normalizeWalletAddress(walletAddress);
  const existing = await readPath<unknown>(sparksPath(wallet));
  if (!existing) return defaultSparkState();
  return normalizeSparkState(existing);
}

/** Parallel user + sparks for home (RTDB has no batch API). */
export async function fetchHomePlayerFromServer(walletAddress: string): Promise<{
  user: PlayerProfile | null;
  state: StoredSparkState;
}> {
  const wallet = tryNormalizeWalletAddress(walletAddress);
  if (!wallet) {
    return { user: null, state: defaultSparkState() };
  }

  const [user, state] = await Promise.all([
    fetchUserFromServer(wallet).catch(() => null),
    readSparkStateFromServer(wallet),
  ]);
  return { user, state };
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
  const existing = await readPath<unknown>(sparksPath(wallet));
  if (existing) {
    const normalized = normalizeSparkState(existing);
    const forRtdb = sparkStateForRtdb(normalized);
    const storedMax =
      existing &&
      typeof existing === "object" &&
      typeof (existing as { max?: unknown }).max === "number"
        ? (existing as { max: number }).max
        : 0;
    // Always persist when raising SPARK_MAX so RTDB does not keep the old cap.
    const needsRewrite =
      storedMax < SPARK_MAX ||
      JSON.stringify(forRtdb) !== JSON.stringify(existing);
    if (needsRewrite) {
      await writePath(sparksPath(wallet), forRtdb);
    }
    return normalized;
  }

  const initial = defaultSparkState();
  await writePath(sparksPath(wallet), sparkStateForRtdb(initial));
  return initial;
}

export async function getSparkSnapshotFromServer(
  walletAddress: string
): Promise<ReturnType<typeof computeSparkSnapshot>> {
  const state = await readSparkStateFromServer(walletAddress);
  return computeSparkSnapshot(state);
}

export class SparkSpendError extends Error {
  constructor(
    message: string,
    public readonly code: "NO_SPARKS" | "NO_WALLET"
  ) {
    super(message);
    this.name = "SparkSpendError";
  }
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
  let spent = false;
  let abortNoSparks = false;

  const { committed, snapshot } = await runRtdbTransaction<unknown>(
    sparksPath(wallet),
    (current) => {
      const state = normalizeSparkState(
        current ?? defaultSparkState(),
        now
      );

      if (state.infiniteUntil && state.infiniteUntil > now) {
        spent = false;
        return sparkStateForRtdb(state);
      }

      const next = applySparkSpend(state, now);
      if (!next) {
        abortNoSparks = true;
        return undefined;
      }

      spent = true;
      return sparkStateForRtdb(next);
    }
  );

  if (abortNoSparks || (!committed && !snapshot)) {
    throw new SparkSpendError("No Sparks available.", "NO_SPARKS");
  }

  const state = normalizeSparkState(
    snapshot ?? (await ensureSparkStateOnServer(wallet)),
    now
  );

  // Count every successful game-start (including Infinite Spark) toward weekly activity.
  recordActivityEventBestEffort(wallet, "play");

  return {
    state,
    sparks: computeSparkSnapshot(state),
    spent,
  };
}

// ─── Game gating flags (Firestore mirror for hot paths) ───────────────────────

function gameFlagsPath(gameId: string): string {
  return `gameFlags/${gameId}`;
}

export async function fetchGameGatingFlagsFromRtdb(
  gameId: string
): Promise<GameGatingFlags | null> {
  const cached = getCachedGameFlags(gameId);
  if (cached) return cached;

  const data = await readPath<GameGatingFlags>(gameFlagsPath(gameId));
  if (!data || typeof data !== "object") return null;
  const flags: GameGatingFlags = {
    active: data.active !== false,
    live: data.live !== false,
    hasLeaderboard: data.hasLeaderboard !== false,
    contestLive: data.contestLive === true,
    contestDurationDays: data.contestDurationDays,
    contestTask: data.contestTask,
    contestStartedAt: data.contestStartedAt,
    contestEndsAt: data.contestEndsAt,
  };
  setCachedGameFlags(gameId, flags);
  return flags;
}

export async function syncGameGatingFlagsToRtdb(
  gameId: string,
  flags: GameGatingFlags
): Promise<void> {
  await writePath(gameFlagsPath(gameId), flags);
  setCachedGameFlags(gameId, flags);
}

export async function deleteGameGatingFlagsFromRtdb(gameId: string): Promise<void> {
  await deletePath(gameFlagsPath(gameId));
  invalidateGameFlagsCache(gameId);
}

/** Child keys under `gameFlags/` — used by admin reconcile. */
export async function listGameGatingFlagIds(): Promise<string[]> {
  const keys = (await readPathShallow("gameFlags")) ?? {};
  return Object.keys(keys);
}

// ─── Game play counts ──────────────────────────────────────────────────────────

/** One GET of `gamePlays` — avoids N parallel child reads (Worker subrequest cap). */
async function readAllPlayCounts(): Promise<Record<string, number>> {
  const data = await readPath<unknown>("gamePlays");
  if (!data || typeof data !== "object") return {};

  const counts: Record<string, number> = {};
  for (const [gameId, value] of Object.entries(
    data as Record<string, unknown>
  )) {
    if (typeof value === "number" && Number.isFinite(value)) {
      counts[gameId] = value;
    }
  }
  return counts;
}

/**
 * Play counts for catalog game IDs. One parent GET of `gamePlays`, then
 * filter to catalog IDs. Uses memory + KV shared cache and coalesces misses.
 */
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

/**
 * @deprecated Prefer fetchGamePlayCountsForIds(catalogIds).
 */
export async function fetchAllGamePlayCounts(): Promise<Record<string, number>> {
  return loadPlayCountsWithSharedCache(readAllPlayCounts);
}

export async function fetchGamePlayCount(gameId: string): Promise<number> {
  const cached = getCachedPlayCounts();
  if (cached && typeof cached[gameId] === "number") {
    return cached[gameId];
  }

  const count = await readPath<number>(`gamePlays/${gameId}`);
  const value = typeof count === "number" ? count : 0;
  mergeCachedPlayCounts({ [gameId]: value });
  return value;
}

/** Atomic increment — concurrent plays cannot lose counts. */
export async function incrementGamePlayCount(gameId: string): Promise<number> {
  await incrementPath(`gamePlays/${gameId}`, 1);

  const bumped = bumpCachedPlayCount(gameId, 1);
  // Update KV in place (debounced) — do not delete (avoids stampede).
  schedulePlayCountsKvPersist();

  if (typeof bumped === "number") return bumped;

  return fetchGamePlayCount(gameId);
}

// ─── Leaderboard ─────────────────────────────────────────────────────────────
//
// Layout (new):
//   leaderboards/{gameId}/entries/{wallet|name_*}  — full history (never delete)
//   leaderboards/{gameId}/top/{wallet|name_*}      — small top-N mirror for reads
// Legacy flat keys under leaderboards/{gameId}/{wallet} are still read as fallback.

function leaderboardEntriesPath(gameId: string, storageKey: string): string {
  return `leaderboards/${gameId}/entries/${storageKey}`;
}

function leaderboardTopPath(gameId: string): string {
  return `leaderboards/${gameId}/top`;
}

function leaderboardLegacyEntryPath(gameId: string, storageKey: string): string {
  return `leaderboards/${gameId}/${storageKey}`;
}

function contestLeaderboardPath(
  gameId: string,
  contestStartedAt: number
): string {
  return `contestLeaderboards/${gameId}/${contestStartedAt}`;
}

function contestEntriesPath(
  gameId: string,
  contestStartedAt: number,
  wallet: string
): string {
  return `${contestLeaderboardPath(gameId, contestStartedAt)}/entries/${wallet}`;
}

function contestTopPath(gameId: string, contestStartedAt: number): string {
  return `${contestLeaderboardPath(gameId, contestStartedAt)}/top`;
}

function entriesToTopMap(entries: LeaderboardEntry[]): LeaderboardMap {
  const map: LeaderboardMap = {};
  for (const entry of entries) {
    map[leaderboardStorageKey(entry)] = entry;
  }
  return map;
}

function mergeIntoTopMirror(
  currentTop: LeaderboardMap | null,
  payload: LeaderboardEntry,
  mirrorSize: number
): LeaderboardMap | null {
  const ranked = deduplicateLeaderboardEntries(
    mapToLeaderboardEntries(currentTop)
  ).sort((a, b) => b.score - a.score);

  const userKey = leaderboardUserKey(payload);
  const withoutUser = ranked.filter((e) => leaderboardUserKey(e) !== userKey);
  const lowestKept = withoutUser[mirrorSize - 1];

  const alreadyInTop = ranked.some((e) => leaderboardUserKey(e) === userKey);
  if (
    !alreadyInTop &&
    withoutUser.length >= mirrorSize &&
    lowestKept &&
    payload.score < lowestKept.score
  ) {
    return null;
  }

  const next = [...withoutUser, payload]
    .sort((a, b) => b.score - a.score)
    .slice(0, mirrorSize);

  return entriesToTopMap(next);
}

async function loadLegacyLeaderboardMap(
  gameId: string
): Promise<LeaderboardMap | null> {
  const root = await readPath<Record<string, unknown>>(`leaderboards/${gameId}`);
  if (!root || typeof root !== "object") return null;

  const map: LeaderboardMap = {};
  for (const [key, value] of Object.entries(root)) {
    if (key === "top" || key === "entries") continue;
    if (!value || typeof value !== "object") continue;
    const entry = value as LeaderboardEntry;
    if (typeof entry.score !== "number" || typeof entry.name !== "string") {
      continue;
    }
    map[key] = entry;
  }
  return Object.keys(map).length > 0 ? map : null;
}

async function ensureLeaderboardTopMirror(
  gameId: string
): Promise<LeaderboardEntry[]> {
  const top = await readPath<LeaderboardMap>(leaderboardTopPath(gameId));
  if (top && Object.keys(top).length > 0) {
    return deduplicateLeaderboardEntries(mapToLeaderboardEntries(top)).sort(
      (a, b) => b.score - a.score
    );
  }

  // One-time rebuild: merge nested entries + legacy flat keys, then seed top.
  const [nested, legacy] = await Promise.all([
    readPath<LeaderboardMap>(`leaderboards/${gameId}/entries`),
    loadLegacyLeaderboardMap(gameId),
  ]);

  const ranked = deduplicateLeaderboardEntries([
    ...mapToLeaderboardEntries(nested),
    ...mapToLeaderboardEntries(legacy),
  ])
    .sort((a, b) => b.score - a.score)
    .slice(0, LEADERBOARD_TOP_MIRROR_SIZE);

  if (ranked.length > 0) {
    await writePath(leaderboardTopPath(gameId), entriesToTopMap(ranked)).catch(
      () => {}
    );
  }

  return ranked;
}

async function ensureContestTopMirror(
  gameId: string,
  contestStartedAt: number
): Promise<LeaderboardEntry[]> {
  const base = contestLeaderboardPath(gameId, contestStartedAt);
  const top = await readPath<LeaderboardMap>(
    contestTopPath(gameId, contestStartedAt)
  );
  if (top && Object.keys(top).length > 0) {
    return deduplicateLeaderboardEntries(mapToLeaderboardEntries(top)).sort(
      (a, b) => b.score - a.score
    );
  }

  const [nested, legacyRoot] = await Promise.all([
    readPath<LeaderboardMap>(`${base}/entries`),
    readPath<Record<string, unknown>>(base),
  ]);

  const legacy: LeaderboardMap = {};
  if (legacyRoot) {
    for (const [key, value] of Object.entries(legacyRoot)) {
      if (key === "top" || key === "entries") continue;
      if (!value || typeof value !== "object") continue;
      const entry = value as LeaderboardEntry;
      if (typeof entry.score !== "number" || typeof entry.name !== "string") {
        continue;
      }
      legacy[key] = entry;
    }
  }

  const ranked = deduplicateLeaderboardEntries([
    ...mapToLeaderboardEntries(nested),
    ...mapToLeaderboardEntries(legacy),
  ])
    .sort((a, b) => b.score - a.score)
    .slice(0, CONTEST_TOP_MIRROR_SIZE);

  if (ranked.length > 0) {
    await writePath(
      contestTopPath(gameId, contestStartedAt),
      entriesToTopMap(ranked)
    ).catch(() => {});
  }

  return ranked;
}

export async function fetchLeaderboardFromServer(
  gameId: string,
  limit = LEADERBOARD_MAX_ENTRIES
): Promise<LeaderboardEntry[]> {
  const ranked = await ensureLeaderboardTopMirror(gameId);
  return ranked.slice(0, limit);
}

/** Best score officially submitted to the public leaderboard. */
export async function fetchUserSubmittedScoreFromServer(
  gameId: string,
  opts: { walletAddress?: string; playerName?: string }
): Promise<number> {
  const wallet = tryNormalizeWalletAddress(opts.walletAddress);
  const name = opts.playerName?.trim().toLowerCase();
  if (!wallet && !name) return 0;

  if (wallet) {
    const key = wallet;
    const fromEntries = await readPath<LeaderboardEntry>(
      leaderboardEntriesPath(gameId, key)
    );
    if (fromEntries && typeof fromEntries.score === "number") {
      return fromEntries.score;
    }

    const legacy = await readPath<LeaderboardEntry>(
      leaderboardLegacyEntryPath(gameId, key)
    );
    if (legacy && typeof legacy.score === "number") {
      return legacy.score;
    }
  }

  if (name) {
    const key = `name_${name.replace(/[.#$[\]/]/g, "_")}`;
    const fromEntries = await readPath<LeaderboardEntry>(
      leaderboardEntriesPath(gameId, key)
    );
    if (fromEntries && typeof fromEntries.score === "number") {
      return fromEntries.score;
    }

    const legacy = await readPath<LeaderboardEntry>(
      leaderboardLegacyEntryPath(gameId, key)
    );
    if (legacy && typeof legacy.score === "number") {
      return legacy.score;
    }
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
  const existing =
    (await readPath<LeaderboardEntry>(
      leaderboardEntriesPath(gameId, storageKey)
    )) ??
    (await readPath<LeaderboardEntry>(
      leaderboardLegacyEntryPath(gameId, storageKey)
    ));

  if (existing && typeof existing.score === "number" && existing.score >= payload.score) {
    return;
  }

  // Full history under entries/. Top mirror stays O(N) small for reads.
  await writePath(leaderboardEntriesPath(gameId, storageKey), payload);

  await runRtdbTransaction<LeaderboardMap>(
    leaderboardTopPath(gameId),
    (current) => {
      const next = mergeIntoTopMirror(
        current,
        payload,
        LEADERBOARD_TOP_MIRROR_SIZE
      );
      if (next) return next;
      if (!current || Object.keys(current).length === 0) {
        return entriesToTopMap([payload]);
      }
      return undefined;
    }
  );
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

  const existing =
    (await readPath<LeaderboardEntry>(
      contestEntriesPath(gameId, contestStartedAt, wallet)
    )) ??
    (await readPath<LeaderboardEntry>(
      `${contestLeaderboardPath(gameId, contestStartedAt)}/${wallet}`
    ));

  if (existing && typeof existing.score === "number" && existing.score >= payload.score) {
    return;
  }

  await writePath(contestEntriesPath(gameId, contestStartedAt, wallet), payload);

  await runRtdbTransaction<LeaderboardMap>(
    contestTopPath(gameId, contestStartedAt),
    (current) => {
      const next = mergeIntoTopMirror(
        current,
        payload,
        CONTEST_TOP_MIRROR_SIZE
      );
      if (next) return next;
      if (!current || Object.keys(current).length === 0) {
        return entriesToTopMap([payload]);
      }
      return undefined;
    }
  );
}

export async function fetchContestLeaderboardFromServer(
  gameId: string,
  contestStartedAt: number,
  limit = CONTEST_MAX_ENTRIES
): Promise<LeaderboardEntry[]> {
  const ranked = await ensureContestTopMirror(gameId, contestStartedAt);
  return ranked.slice(0, limit);
}

// ─── Per-user game progress ───────────────────────────────────────────────────

function gameProgressPath(walletAddress: string, gameId: string): string {
  return `users/${normalizeWalletAddress(walletAddress)}/games/${gameId}`;
}

export function readStoredScore(stored: StoredGameProgress | null): number {
  if (!stored) return 0;
  if (typeof stored.s === "number") return stored.s;
  if (typeof stored.score === "number") return stored.score;
  if (typeof stored.highScore === "number") return stored.highScore;
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

  // Prefer canonical `st.modes`, but also recover Line Link's easyLevel /
  // mediumLevel / advancedLevel keys if an older write stored only those.
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
  return readPath<StoredGameProgress>(gameProgressPath(walletAddress, gameId));
}

/**
 * Resolves progress for API / bootstrap. Personal best lives in users/{wallet}/games/{gameId}.s
 * and is never auto-synced to the public leaderboard.
 */
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

      const { committed, snapshot } =
        await runRtdbTransaction<StoredGameProgress>(
          gameProgressPath(wallet, gameId),
          (current) => {
            const currentValue = hasLeaderboard
              ? readStoredScore(current)
              : (current?.l ?? 0);
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

            if (!scalarImproved && !stateChanged) {
              return undefined;
            }

            const next: StoredGameProgress = { ...(current ?? {}) };
            if (scalarImproved || (hasModes && !hasLeaderboard && nextScalar > 0)) {
              next[field] = Math.max(currentValue, nextScalar);
            }
            if (nextState) {
              next.st = nextState;
              next.r = (typeof current?.r === "number" ? current.r : 0) + 1;
            }
            return next;
          }
        );

      const stored =
        snapshot ??
        (committed
          ? ({
              [field]: batch.value,
              ...(hasModes || hasExtras
                ? {
                    st: {
                      ...extrasToApply,
                      ...(modeLevelsToStoredState(modesToApply) ?? {}),
                    },
                    r: 1,
                  }
                : {}),
            } as StoredGameProgress)
          : await fetchGameProgressFromServer(wallet, gameId));

      return storedProgressToGameProgress(stored, hasLeaderboard);
    },
    { modes: incomingModes, extras: incomingExtras }
  );
}

export type GameStateRecord = {
  found: boolean;
  revision: number;
  state: Record<string, unknown> | null;
};

const GAME_STATE_MAX_BYTES = 256 * 1024;
const UNSAFE_RTDB_KEY = /[.$#[\]/]/;

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
      if (!key || UNSAFE_RTDB_KEY.test(key)) continue;
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

/** Level games often put the unlocked level inside the checkpoint blob. */
function levelFromCheckpointState(
  state: Record<string, unknown> | null | undefined
): number | null {
  if (!state) return null;
  for (const key of ["level", "l", "currentLevel", "unlockedLevel"] as const) {
    const raw = state[key];
    if (typeof raw === "number" && Number.isFinite(raw) && raw > 0) {
      return Math.floor(raw);
    }
  }

  const modesMax = maxModeLevel(extractModeLevels(state));
  return modesMax > 0 ? modesMax : null;
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

export class GameStateConflictError extends Error {
  revision: number;
  state: Record<string, unknown> | null;

  constructor(revision: number, state: Record<string, unknown> | null) {
    super("Game state revision conflict.");
    this.name = "GameStateConflictError";
    this.revision = revision;
    this.state = state;
  }
}

/**
 * Writes Unity checkpoint data to users/{wallet}/games/{gameId}.st
 * without clobbering personal-best s/l.
 */
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
  const conflictBox: { value: GameStateRecord | null } = { value: null };

  const { snapshot } = await runRtdbTransaction<StoredGameProgress>(
    gameProgressPath(wallet, gameId),
    (current) => {
      const currentRevision = typeof current?.r === "number" ? current.r : 0;
      if (
        typeof opts?.baseRevision === "number" &&
        opts.baseRevision > 0 &&
        currentRevision > 0 &&
        opts.baseRevision !== currentRevision
      ) {
        conflictBox.value = {
          found: readStoredGameState(current) != null,
          revision: currentRevision,
          state: readStoredGameState(current),
        };
        return undefined;
      }

      const currentState = readStoredGameState(current) ?? {};
      let nextState = opts?.merge ? { ...currentState, ...incoming } : incoming;

      // Normalize Line Link easyLevel/mediumLevel/advancedLevel into st.modes
      // and mirror those fields so Unity can read either shape.
      const mergedModes = mergeModeLevels(
        readStoredModeLevels({ st: currentState } as StoredGameProgress),
        extractModeLevels(nextState)
      );
      const modeState = modeLevelsToStoredState(mergedModes);
      if (modeState) {
        nextState = { ...nextState, ...modeState };
      }

      const levelFromState = levelFromCheckpointState(nextState);
      const currentLevel = typeof current?.l === "number" ? current.l : 0;
      const nextLevel =
        levelFromState != null && levelFromState > currentLevel
          ? levelFromState
          : current?.l;

      return {
        ...(current ?? {}),
        st: nextState,
        r: currentRevision + 1,
        ...(typeof nextLevel === "number" ? { l: nextLevel } : {}),
      };
    }
  );

  if (conflictBox.value) {
    throw new GameStateConflictError(
      conflictBox.value.revision,
      conflictBox.value.state
    );
  }

  const stored =
    snapshot ?? (await fetchGameProgressFromServer(wallet, gameId));
  const savedState = readStoredGameState(stored) ?? incoming;

  return {
    found: true,
    revision: typeof stored?.r === "number" ? stored.r : 1,
    state: savedState,
  };
}

// ─── Weekly activity leaderboard ─────────────────────────────────────────────
//
// users/{wallet}/activity/{weekId}
// activityLeaderboards/{weekId}/entries/{wallet}
// activityLeaderboards/{weekId}/top/{wallet}

type ActivityLeaderboardMap = Record<string, ActivityLeaderboardEntry>;

function userActivityPath(wallet: string, weekId: string): string {
  return `users/${normalizeWalletAddress(wallet)}/activity/${weekId}`;
}

function activityEntriesPath(weekId: string, wallet: string): string {
  return `activityLeaderboards/${weekId}/entries/${normalizeWalletAddress(wallet)}`;
}

function activityTopPath(weekId: string): string {
  return `activityLeaderboards/${weekId}/top`;
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
    checkIns: counters.checkIns,
    updatedAt: counters.updatedAt,
  };
}

function mapToActivityEntries(
  map: ActivityLeaderboardMap | null | undefined
): ActivityLeaderboardEntry[] {
  if (!map || typeof map !== "object") return [];
  const out: ActivityLeaderboardEntry[] = [];
  for (const value of Object.values(map)) {
    if (!value || typeof value !== "object") continue;
    if (typeof value.score !== "number" || typeof value.name !== "string") {
      continue;
    }
    const wallet = tryNormalizeWalletAddress(value.walletAddress);
    if (!wallet) continue;
    out.push(
      resolveActivityEntryXp({
        name: value.name,
        score: value.score,
        walletAddress: wallet,
        sparksSpent:
          typeof (value as ActivityLeaderboardEntry).sparksSpent === "number"
            ? (value as ActivityLeaderboardEntry).sparksSpent
            : undefined,
        activeDays:
          typeof value.activeDays === "number" ? value.activeDays : undefined,
        txs: typeof value.txs === "number" ? value.txs : undefined,
        spendUnits:
          typeof value.spendUnits === "number" ? value.spendUnits : undefined,
        updatedAt:
          typeof value.updatedAt === "number" ? value.updatedAt : undefined,
      })
    );
  }
  return out;
}

function activityEntriesToTopMap(
  entries: ActivityLeaderboardEntry[]
): ActivityLeaderboardMap {
  const map: ActivityLeaderboardMap = {};
  for (const entry of entries) {
    map[normalizeWalletAddress(entry.walletAddress)] = entry;
  }
  return map;
}

function mergeActivityIntoTopMirror(
  currentTop: ActivityLeaderboardMap | null,
  payload: ActivityLeaderboardEntry,
  mirrorSize: number
): ActivityLeaderboardMap | null {
  const ranked = mapToActivityEntries(currentTop).sort(compareActivityEntries);
  const wallet = normalizeWalletAddress(payload.walletAddress);
  const withoutUser = ranked.filter(
    (e) => normalizeWalletAddress(e.walletAddress) !== wallet
  );
  const lowestKept = withoutUser[mirrorSize - 1];
  const alreadyInTop = ranked.some(
    (e) => normalizeWalletAddress(e.walletAddress) === wallet
  );

  if (
    !alreadyInTop &&
    withoutUser.length >= mirrorSize &&
    lowestKept &&
    compareActivityEntries(payload, lowestKept) > 0
  ) {
    return null;
  }

  const next = [...withoutUser, payload]
    .sort(compareActivityEntries)
    .slice(0, mirrorSize);

  return activityEntriesToTopMap(next);
}

async function ensureActivityTopMirror(
  weekId: string
): Promise<ActivityLeaderboardEntry[]> {
  const top = await readPath<ActivityLeaderboardMap>(activityTopPath(weekId));
  if (top && Object.keys(top).length > 0) {
    return mapToActivityEntries(top).sort(compareActivityEntries);
  }

  const nested = await readPath<ActivityLeaderboardMap>(
    `activityLeaderboards/${weekId}/entries`
  );
  const ranked = mapToActivityEntries(nested)
    .sort(compareActivityEntries)
    .slice(0, ACTIVITY_TOP_MIRROR_SIZE);

  if (ranked.length > 0) {
    await writePath(activityTopPath(weekId), activityEntriesToTopMap(ranked)).catch(
      () => {}
    );
  }
  return ranked;
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

    let profileName = opts?.name?.trim() || "";
    if (!profileName) {
      const profile = await fetchUserFromServer(wallet).catch(() => null);
      profileName = profile?.name?.trim() || "";
    }

    const path = userActivityPath(wallet, weekId);
    const existing = coerceActivityCounters(await readPath<unknown>(path));
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

    if (kind === "checkin") {
      next.checkIns += 1;
    }

    if (
      kind === "tx" ||
      kind === "spend" ||
      kind === "play" ||
      kind === "visit" ||
      kind === "checkin"
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
      next.activeDays === existing.activeDays &&
      next.checkIns === existing.checkIns
    ) {
      return;
    }

    await writePath(path, next);

    // Public board is sparks-first — don't list visit-only / 0-spark users.
    if (next.sparksSpent <= 0) {
      return;
    }

    const entry = activityEntryFromCounters(wallet, next);
    await writePath(activityEntriesPath(weekId, wallet), entry);

    await runRtdbTransaction<ActivityLeaderboardMap>(
      activityTopPath(weekId),
      (current) => {
        const merged = mergeActivityIntoTopMirror(
          current,
          entry,
          ACTIVITY_TOP_MIRROR_SIZE
        );
        if (merged) return merged;
        if (!current || Object.keys(current).length === 0) {
          return activityEntriesToTopMap([entry]);
        }
        return undefined;
      }
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(
      `[ArcadeX][activity] recordActivityEvent failed: ${scrubSecrets(message)}`
    );
  }
}

/** Fire-and-forget via waitUntil so the Worker isolate stays alive after the response. */
export function recordActivityEventBestEffort(
  walletAddress: string,
  kind: ActivityEventKind,
  opts?: { spendUnits?: number; name?: string }
): void {
  // Rate-limit / KV paths prime getWorkerContext() earlier in the same request.
  scheduleWorkerWork(recordActivityEvent(walletAddress, kind, opts));
}

export async function countActivityParticipants(
  weekId: string
): Promise<number> {
  const entries = await fetchActivityLeaderboardFromServer(
    weekId,
    ACTIVITY_TOP_MIRROR_SIZE
  );
  return entries.filter((e) => (e.sparksSpent ?? 0) > 0 || e.score > 0).length;
}

export async function fetchActivityLeaderboardFromServer(
  weekId: string,
  limit = ACTIVITY_LEADERBOARD_MAX_ENTRIES
): Promise<ActivityLeaderboardEntry[]> {
  const ranked = await ensureActivityTopMirror(weekId);
  return ranked.filter((e) => e.score > 0).slice(0, limit);
}

export async function fetchUserActivityFromServer(
  walletAddress: string,
  weekId: string
): Promise<ActivityCounters> {
  if (!isWalletAddress(walletAddress)) return emptyActivityCounters();
  const wallet = normalizeWalletAddress(walletAddress);
  const raw = await readPath<unknown>(userActivityPath(wallet, weekId));
  return coerceActivityCounters(raw);
}

export function resolveActivityWeekId(
  weekParam: string | null | undefined,
  now = Date.now()
): { weekId: string; startsAt: number; endsAt: number; isCurrent: boolean } {
  const current = getIsoWeekWindow(now);
  const previous = getPreviousIsoWeekWindow(now);

  if (!weekParam || weekParam === "current") {
    return { ...current, isCurrent: true };
  }
  if (weekParam === "prev" || weekParam === "previous") {
    return { ...previous, isCurrent: false };
  }
  if (weekParam === current.weekId) {
    return { ...current, isCurrent: true };
  }
  if (weekParam === previous.weekId) {
    return { ...previous, isCurrent: false };
  }
  return {
    weekId: weekParam,
    startsAt: 0,
    endsAt: 0,
    isCurrent: false,
  };
}

export function findActivityRank(
  entries: ActivityLeaderboardEntry[],
  walletAddress: string
): number | null {
  const wallet = tryNormalizeWalletAddress(walletAddress);
  if (!wallet) return null;
  const idx = entries.findIndex(
    (e) => normalizeWalletAddress(e.walletAddress) === wallet
  );
  return idx >= 0 ? idx + 1 : null;
}
