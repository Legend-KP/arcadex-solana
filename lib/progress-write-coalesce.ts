/**
 * Coalesce progress POSTs per wallet+game so a burst of Unity saves
 * becomes fewer RTDB writes of the highest value / merged modes.
 *
 * - Solo save: short settle window (catches parallel double-posts), then write.
 * - Overlapping saves: share one in-flight write of the max value + merged modes.
 */

/** Short settle window — long delays risk client abort before D1 flush. */
export const PROGRESS_WRITE_COALESCE_MS = 400;

export type ProgressWriteBatch = {
  value: number;
  modes: Record<string, number>;
  extras: Record<string, unknown>;
};

type CoalesceEntry<T> = {
  batch: ProgressWriteBatch;
  promise: Promise<T>;
  resolve: (result: T) => void;
  reject: (err: unknown) => void;
  /** True once the settle timer fired and write started. */
  flushing: boolean;
};

const pending = new Map<string, CoalesceEntry<unknown>>();

function coalesceKey(wallet: string, gameId: string): string {
  return `${wallet.toLowerCase()}:${gameId}`;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function mergeModes(
  into: Record<string, number>,
  from: Record<string, number> | undefined
): void {
  if (!from) return;
  for (const [mode, level] of Object.entries(from)) {
    if (typeof level !== "number" || !Number.isFinite(level) || level < 0) continue;
    into[mode] = Math.max(into[mode] ?? 0, Math.floor(level));
  }
}

/**
 * Debounce concurrent/rapid saves: collect max `value` + per-mode levels
 * for a short window, then call `write(batch)` once.
 */
export async function coalesceProgressWrite<T>(
  wallet: string,
  gameId: string,
  value: number,
  write: (batch: ProgressWriteBatch) => Promise<T>,
  opts?: {
    modes?: Record<string, number>;
    extras?: Record<string, unknown>;
  }
): Promise<T> {
  const key = coalesceKey(wallet, gameId);
  const existing = pending.get(key) as CoalesceEntry<T> | undefined;

  if (existing) {
    existing.batch.value = Math.max(existing.batch.value, value);
    mergeModes(existing.batch.modes, opts?.modes);
    if (opts?.extras) Object.assign(existing.batch.extras, opts.extras);
    return existing.promise;
  }

  let resolve!: (result: T) => void;
  let reject!: (err: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });

  const batch: ProgressWriteBatch = {
    value,
    modes: {},
    extras: {},
  };
  mergeModes(batch.modes, opts?.modes);
  if (opts?.extras) Object.assign(batch.extras, opts.extras);

  const entry: CoalesceEntry<T> = {
    batch,
    promise,
    resolve,
    reject,
    flushing: false,
  };
  pending.set(key, entry as CoalesceEntry<unknown>);

  try {
    await sleep(PROGRESS_WRITE_COALESCE_MS);

    entry.flushing = true;
    const latest =
      (pending.get(key) as CoalesceEntry<T> | undefined)?.batch ?? batch;
    const finalBatch: ProgressWriteBatch = {
      value: Math.max(batch.value, latest.value),
      modes: { ...batch.modes },
      extras: { ...batch.extras, ...latest.extras },
    };
    mergeModes(finalBatch.modes, latest.modes);
    pending.delete(key);

    const result = await write(finalBatch);
    entry.resolve(result);
    return result;
  } catch (err) {
    pending.delete(key);
    entry.reject(err);
    throw err;
  }
}
