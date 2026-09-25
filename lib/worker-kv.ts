/** Shared Cloudflare KV access (RATE_LIMIT_KV binding: catalog, play counts, streak). */

import { assertSolanaKvId } from "@/lib/solana-data-plane";
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

let verifiedKv: Promise<KvLike | null> | null = null;

async function openSolanaKv(): Promise<KvLike | null> {
  const ctx = await getWorkerContext();
  const env = ctx?.env as
    | { RATE_LIMIT_KV?: KvLike; KV_NAMESPACE_ID?: string }
    | undefined;
  const kv = env?.RATE_LIMIT_KV;
  if (!kv) return null;

  assertSolanaKvId(env?.KV_NAMESPACE_ID ?? process.env.KV_NAMESPACE_ID);

  const plane = await kv.get("data_plane");
  if (plane !== "solana") {
    throw new Error(
      "ArcadeX Solana refuses this KV namespace. data_plane is not solana."
    );
  }
  return kv;
}

export async function getWorkerKv(): Promise<KvLike | null> {
  try {
    if (!verifiedKv) {
      verifiedKv = openSolanaKv().catch((err) => {
        verifiedKv = null;
        throw err;
      });
    }
    return await verifiedKv;
  } catch (err) {
    console.error(
      "[ArcadeX] KV refused:",
      err instanceof Error ? err.message : err
    );
    return null;
  }
}
