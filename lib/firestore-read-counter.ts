/**
 * Request-scoped Firestore read counting for API metrics.
 * Uses AsyncLocalStorage so concurrent isolate requests do not cross-count.
 */

import { AsyncLocalStorage } from "node:async_hooks";

type Store = { reads: number };

const storage = new AsyncLocalStorage<Store>();

/** Run `fn` with a fresh read counter; returns result + how many Firestore reads occurred. */
export async function withFirestoreReadCounter<T>(
  fn: () => Promise<T>
): Promise<{ result: T; firestoreReads: number }> {
  const store: Store = { reads: 0 };
  const result = await storage.run(store, fn);
  return { result, firestoreReads: store.reads };
}

/** Record document reads (list = N docs, get = 1). No-op outside withFirestoreReadCounter. */
export function noteFirestoreReads(count: number): void {
  if (!Number.isFinite(count) || count <= 0) return;
  const store = storage.getStore();
  if (store) store.reads += count;
}

export function getFirestoreReadsInContext(): number {
  return storage.getStore()?.reads ?? 0;
}
