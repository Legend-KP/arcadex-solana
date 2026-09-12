import { Game } from "@/types";
import { invalidateGameFlagsCache } from "@/lib/rtdb-cache";
import { getWorkerKv } from "@/lib/worker-kv";

/** Full games list — refreshed on admin mutations. */
export const GAME_LIST_TTL_MS = 60_000;

/** Single game doc — admin edits are rare. */
export const GAME_DOC_TTL_MS = 300_000;

/**
 * Hide / Coming Soon are admin-toggled. Never HTTP-cache the catalog:
 * public vs admin responses differ, and CDN cache hid those changes.
 */
export const GAMES_API_CACHE_CONTROL =
  "private, no-store, no-cache, must-revalidate";

const CATALOG_GEN_KV_KEY = "cache:gamesCatalog:gen";
const CATALOG_GEN_KV_TTL_SEC = 60 * 60 * 24 * 7;
const CATALOG_LIST_KV_KEY = "cache:gamesCatalog:list:v1";
const CATALOG_LIST_KV_TTL_SEC = Math.ceil(GAME_LIST_TTL_MS / 1000);

type CacheEntry<T> = {
  value: T;
  expiresAt: number;
};

let gameListEntry: CacheEntry<Game[]> | null = null;
const gameDocEntries = new Map<string, CacheEntry<Game>>();

/** Served when Firestore is unavailable (circuit breaker). */
let lastGoodGameList: Game[] | null = null;
const lastGoodGameDocs = new Map<string, Game>();

let firestoreCircuitOpenUntil = 0;
let firestoreConsecutiveFailures = 0;

/** Shared catalog generation — other isolates drop memory cache when this changes. */
let localCatalogGeneration: number | null = null;
let catalogEpoch = 0;

export function getCatalogEpoch(): number {
  return catalogEpoch;
}

function bumpLocalEpoch(): void {
  catalogEpoch += 1;
}

export type GameCacheStats = {
  listHits: number;
  listMisses: number;
  docHits: number;
  docMisses: number;
  circuitBreakerTrips: number;
};

const stats: GameCacheStats = {
  listHits: 0,
  listMisses: 0,
  docHits: 0,
  docMisses: 0,
  circuitBreakerTrips: 0,
};

export function getGameCacheStats(): Readonly<GameCacheStats> {
  return { ...stats };
}

function isFresh<T>(entry: CacheEntry<T> | null | undefined): entry is CacheEntry<T> {
  return Boolean(entry && Date.now() < entry.expiresAt);
}

export function getCachedGameList(): Game[] | null {
  if (isFresh(gameListEntry)) {
    stats.listHits += 1;
    return gameListEntry.value;
  }
  stats.listMisses += 1;
  return null;
}

export function setCachedGameList(games: Game[], persistShared = true): void {
  const expiresAt = Date.now() + GAME_LIST_TTL_MS;
  gameListEntry = { value: games, expiresAt };
  lastGoodGameList = games;
  for (const game of games) {
    setCachedGameDoc(game.id, game);
  }
  if (persistShared) void persistSharedCatalogList(games);
}

async function persistSharedCatalogList(games: Game[]): Promise<void> {
  try {
    const kv = await getWorkerKv();
    await kv?.put(CATALOG_LIST_KV_KEY, JSON.stringify({ games }), {
      expirationTtl: CATALOG_LIST_KV_TTL_SEC,
    });
  } catch {
    // Memory cache still valid if KV is unavailable.
  }
}

/** Shared catalog JSON — used when this isolate's memory cache is cold. */
export async function readSharedCatalogList(): Promise<Game[] | null> {
  try {
    const kv = await getWorkerKv();
    const raw = await kv?.get(CATALOG_LIST_KV_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { games?: Game[] };
    if (!Array.isArray(parsed.games) || parsed.games.length === 0) return null;
    return parsed.games;
  } catch {
    return null;
  }
}

async function deleteSharedCatalogList(): Promise<void> {
  try {
    const kv = await getWorkerKv();
    await kv?.delete?.(CATALOG_LIST_KV_KEY);
  } catch {
    // Next TTL expiry still drops a stale list.
  }
}

export function getCachedGameDoc(id: string): Game | null {
  const entry = gameDocEntries.get(id);
  if (isFresh(entry)) {
    stats.docHits += 1;
    return entry.value;
  }
  stats.docMisses += 1;
  return null;
}

export function setCachedGameDoc(id: string, game: Game): void {
  gameDocEntries.set(id, {
    value: game,
    expiresAt: Date.now() + GAME_DOC_TTL_MS,
  });
  lastGoodGameDocs.set(id, game);
}

/** Keep list + circuit-breaker fallback in sync after an admin patch. */
export function upsertCachedGame(game: Game): void {
  setCachedGameDoc(game.id, game);
  if (gameListEntry) {
    gameListEntry = {
      value: gameListEntry.value.map((g) => (g.id === game.id ? game : g)),
      expiresAt: gameListEntry.expiresAt,
    };
  }
  if (lastGoodGameList) {
    lastGoodGameList = lastGoodGameList.map((g) =>
      g.id === game.id ? game : g
    );
  }
  const list = gameListEntry?.value ?? lastGoodGameList;
  if (list) void persistSharedCatalogList(list);
}

function dropFreshCatalogCaches(): void {
  bumpLocalEpoch();
  gameListEntry = null;
  gameDocEntries.clear();
  invalidateGameFlagsCache();
}

/**
 * If another isolate bumped the catalog generation (Hide / Coming Soon),
 * drop this isolate's in-memory games so the next read hits Firestore.
 */
/** @returns true when this isolate dropped memory because generation changed */
export async function refreshCatalogCacheIfStale(): Promise<boolean> {
  try {
    const kv = await getWorkerKv();
    const raw = await kv?.get(CATALOG_GEN_KV_KEY);
    if (!raw) return false;
    const shared = Number(raw);
    if (!Number.isFinite(shared) || shared === localCatalogGeneration) {
      return false;
    }
    dropFreshCatalogCaches();
    localCatalogGeneration = shared;
    return true;
  } catch {
    return false;
  }
}

/** Call after every admin catalog mutation so other isolates see Hide / Live. */
export async function bumpCatalogGeneration(): Promise<void> {
  const next = Date.now();
  localCatalogGeneration = next;
  try {
    const kv = await getWorkerKv();
    await kv?.put(CATALOG_GEN_KV_KEY, String(next), {
      expirationTtl: CATALOG_GEN_KV_TTL_SEC,
    });
    await kv?.delete?.(CATALOG_LIST_KV_KEY);
  } catch {
    await deleteSharedCatalogList();
  }
}

/** Clear single-doc cache first, then list (invalidation order). */
export function invalidateGameCache(gameId?: string): void {
  bumpLocalEpoch();
  if (gameId) {
    gameDocEntries.delete(gameId);
  } else {
    gameDocEntries.clear();
    lastGoodGameDocs.clear();
    lastGoodGameList = null;
  }
  gameListEntry = null;
  invalidateGameFlagsCache(gameId);
}

/** Drop a deleted game from circuit-breaker fallbacks. */
export function removeCachedGame(gameId: string): void {
  invalidateGameCache(gameId);
  lastGoodGameDocs.delete(gameId);
  if (lastGoodGameList) {
    lastGoodGameList = lastGoodGameList.filter((g) => g.id !== gameId);
  }
}

export function getStaleGameListFallback(): Game[] | null {
  return lastGoodGameList;
}

export function getStaleGameDocFallback(id: string): Game | null {
  return lastGoodGameDocs.get(id) ?? null;
}

export function isFirestoreCircuitOpen(): boolean {
  return Date.now() < firestoreCircuitOpenUntil;
}

export function recordFirestoreSuccess(): void {
  firestoreConsecutiveFailures = 0;
  firestoreCircuitOpenUntil = 0;
}

const CIRCUIT_FAILURE_THRESHOLD = 3;
const CIRCUIT_OPEN_MS = 30_000;

export function recordFirestoreFailure(status?: number): void {
  const isQuotaOrServer =
    status === 429 || status === 503 || (status !== undefined && status >= 500);

  if (!isQuotaOrServer && status !== undefined && status < 500) {
    return;
  }

  firestoreConsecutiveFailures += 1;
  if (firestoreConsecutiveFailures >= CIRCUIT_FAILURE_THRESHOLD) {
    firestoreCircuitOpenUntil = Date.now() + CIRCUIT_OPEN_MS;
    stats.circuitBreakerTrips += 1;
    firestoreConsecutiveFailures = 0;
  }
}
