import { GameGatingFlags } from "@/types";
import { getWorkerKv } from "@/lib/worker-kv";
import { scheduleWorkerWork } from "@/lib/worker-context";

/** Home-screen play counts — shared across isolates via KV when available. */
export const PLAY_COUNTS_TTL_MS = 120_000;

/** Hot-path gating flags — invalidated on admin game mutations. */
export const GAME_FLAGS_TTL_MS = 45_000;

const PLAY_COUNTS_KV_KEY = "cache:playCounts:v1";
const PLAY_COUNTS_KV_TTL_SEC = 120;
/** Debounce KV puts so play storms do not hit 1 write/sec/key. */
const PLAY_COUNTS_KV_PERSIST_DEBOUNCE_MS = 10_000;

type CacheEntry<T> = {
  value: T;
  expiresAt: number;
};

let playCountsEntry: CacheEntry<Record<string, number>> | null = null;
const gameFlagsEntries = new Map<string, CacheEntry<GameGatingFlags>>();

/** Coalesce concurrent play-count loads on the same isolate. */
let playCountsInFlight: Promise<Record<string, number>> | null = null;
let playCountsKvPersistPending = false;

function isFresh<T>(entry: CacheEntry<T> | null | undefined): entry is CacheEntry<T> {
  return Boolean(entry && Date.now() < entry.expiresAt);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function getCachedPlayCounts(): Record<string, number> | null {
  if (isFresh(playCountsEntry)) return playCountsEntry.value;
  return null;
}

export function setCachedPlayCounts(counts: Record<string, number>): void {
  playCountsEntry = {
    value: { ...counts },
    expiresAt: Date.now() + PLAY_COUNTS_TTL_MS,
  };
}

/** Merge counts into the in-memory map without shortening TTL. */
export function mergeCachedPlayCounts(counts: Record<string, number>): void {
  const base = isFresh(playCountsEntry) ? playCountsEntry.value : {};
  const expiresAt = isFresh(playCountsEntry)
    ? playCountsEntry.expiresAt
    : Date.now() + PLAY_COUNTS_TTL_MS;
  playCountsEntry = {
    value: { ...base, ...counts },
    expiresAt,
  };
}

/** Bump one game's cached count after an atomic increment (no full re-fetch). */
export function bumpCachedPlayCount(gameId: string, delta = 1): number | null {
  if (!isFresh(playCountsEntry)) return null;
  const next = { ...playCountsEntry.value };
  next[gameId] = (typeof next[gameId] === "number" ? next[gameId] : 0) + delta;
  playCountsEntry = {
    value: next,
    expiresAt: playCountsEntry.expiresAt,
  };
  return next[gameId];
}

export function invalidatePlayCountsCache(): void {
  playCountsEntry = null;
}

async function persistPlayCountsToKv(): Promise<void> {
  const mem = getCachedPlayCounts();
  if (!mem) return;
  try {
    const kv = await getWorkerKv();
    await kv?.put(PLAY_COUNTS_KV_KEY, JSON.stringify(mem), {
      expirationTtl: PLAY_COUNTS_KV_TTL_SEC,
    });
  } catch {
    // Memory cache still valid if KV is unavailable.
  }
}

/**
 * Debounced update-in-place for shared play counts.
 * Avoids delete-on-every-play (hot key + cache stampede into D1/RTDB).
 */
export function schedulePlayCountsKvPersist(): void {
  if (playCountsKvPersistPending) return;
  playCountsKvPersistPending = true;
  scheduleWorkerWork(
    (async () => {
      try {
        await sleep(PLAY_COUNTS_KV_PERSIST_DEBOUNCE_MS);
        await persistPlayCountsToKv();
      } finally {
        playCountsKvPersistPending = false;
      }
    })()
  );
}

/**
 * @deprecated Prefer schedulePlayCountsKvPersist after bumpCachedPlayCount.
 * Kept for rare full invalidation (e.g. admin repair); still debounced put, not delete.
 */
export async function invalidateSharedPlayCountsKv(): Promise<void> {
  schedulePlayCountsKvPersist();
}

/** Drop memory cache; schedule a KV refresh from whatever reloads next. */
export async function invalidateSharedPlayCountsCache(): Promise<void> {
  invalidatePlayCountsCache();
  // Do not delete the KV key — let TTL expire or the next loader overwrite.
}

/**
 * Load play counts with memory → KV → loader, coalescing concurrent misses.
 */
export async function loadPlayCountsWithSharedCache(
  loader: () => Promise<Record<string, number>>
): Promise<Record<string, number>> {
  const mem = getCachedPlayCounts();
  if (mem) return mem;

  if (playCountsInFlight) return playCountsInFlight;

  playCountsInFlight = (async () => {
    try {
      try {
        const kv = await getWorkerKv();
        const raw = await kv?.get(PLAY_COUNTS_KV_KEY);
        if (raw) {
          const parsed = JSON.parse(raw) as Record<string, number>;
          if (parsed && typeof parsed === "object") {
            setCachedPlayCounts(parsed);
            return parsed;
          }
        }
      } catch {
        // fall through to loader
      }

      const counts = await loader();
      setCachedPlayCounts(counts);

      try {
        const kv = await getWorkerKv();
        await kv?.put(PLAY_COUNTS_KV_KEY, JSON.stringify(counts), {
          expirationTtl: PLAY_COUNTS_KV_TTL_SEC,
        });
      } catch {
        // memory cache still valid
      }

      return counts;
    } finally {
      playCountsInFlight = null;
    }
  })();

  return playCountsInFlight;
}

export function getCachedGameFlags(gameId: string): GameGatingFlags | null {
  const entry = gameFlagsEntries.get(gameId);
  if (isFresh(entry)) return entry.value;
  return null;
}

export function setCachedGameFlags(
  gameId: string,
  flags: GameGatingFlags
): void {
  gameFlagsEntries.set(gameId, {
    value: flags,
    expiresAt: Date.now() + GAME_FLAGS_TTL_MS,
  });
}

export function invalidateGameFlagsCache(gameId?: string): void {
  if (gameId) {
    gameFlagsEntries.delete(gameId);
    return;
  }
  gameFlagsEntries.clear();
}
