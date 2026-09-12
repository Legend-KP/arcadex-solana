/** Shared Cloudflare KV access (RATE_LIMIT_KV binding: catalog, play counts, streak). */

import { getWorkerContext } from "@/lib/worker-context";

export type KvLike = {
  get(key: string): Promise<string | null>;
  put(
    key: string,
    value: string,
    options?: { expirationTtl?: number }
  ): Promise<void>;
  delete?(key: string): Promise<void>;
};

export async function getWorkerKv(): Promise<KvLike | null> {
  try {
    const ctx = await getWorkerContext();
    const env = ctx?.env as { RATE_LIMIT_KV?: KvLike } | undefined;
    return env?.RATE_LIMIT_KV ?? null;
  } catch {
    return null;
  }
}
