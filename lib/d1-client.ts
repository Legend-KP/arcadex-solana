/**
 * Cloudflare D1 access for the hybrid player store.
 *
 * On when Worker has `DB` + `PLAYER_DATA_BACKEND=d1`.
 * Production and preview set PLAYER_DATA_BACKEND=d1 in wrangler.jsonc.
 */

import { assertSolanaD1Id } from "@/lib/solana-data-plane";
import { getWorkerContext } from "@/lib/worker-context";

export type D1PreparedStatement = {
  bind: (...values: unknown[]) => D1PreparedStatement;
  first: <T = unknown>() => Promise<T | null>;
  all: <T = unknown>() => Promise<{ results: T[] }>;
  run: () => Promise<{ success: boolean; meta?: { changes?: number } }>;
};

export type D1Result<T = unknown> = {
  success: boolean;
  results?: T[];
  meta?: { changes?: number };
};

export type D1DatabaseLike = {
  prepare: (query: string) => D1PreparedStatement;
  batch: <T = unknown>(
    statements: D1PreparedStatement[]
  ) => Promise<Array<D1Result<T>>>;
};

type EnvWithD1 = {
  DB?: D1DatabaseLike;
  PLAYER_DATA_BACKEND?: string;
  D1_DATABASE_ID?: string;
};

let verifiedD1: Promise<D1DatabaseLike | null> | null = null;

async function getEnv(): Promise<EnvWithD1 | null> {
  const ctx = await getWorkerContext();
  return (ctx?.env as EnvWithD1) ?? null;
}

export async function useD1PlayerData(): Promise<boolean> {
  const env = await getEnv();
  if (!env?.DB) return false;
  const backend = (
    env.PLAYER_DATA_BACKEND ??
    process.env.PLAYER_DATA_BACKEND ??
    ""
  )
    .trim()
    .toLowerCase();
  return backend === "d1";
}

async function openSolanaD1(): Promise<D1DatabaseLike | null> {
  if (!(await useD1PlayerData())) return null;
  const env = await getEnv();
  const db = env?.DB;
  if (!db) return null;

  assertSolanaD1Id(env?.D1_DATABASE_ID ?? process.env.D1_DATABASE_ID);

  const row = await db
    .prepare("SELECT plane FROM data_plane WHERE id = 1")
    .first<{ plane?: string }>();
  if (row?.plane !== "solana") {
    throw new Error(
      "ArcadeX Solana refuses this D1 database. data_plane is not solana."
    );
  }
  return db;
}

export async function getD1(): Promise<D1DatabaseLike | null> {
  if (!verifiedD1) {
    verifiedD1 = openSolanaD1().catch((err) => {
      verifiedD1 = null;
      throw err;
    });
  }
  return verifiedD1;
}

export async function requireD1(): Promise<D1DatabaseLike> {
  const db = await getD1();
  if (!db) {
    throw new Error(
      "D1 player store unavailable. Set PLAYER_DATA_BACKEND=d1 and bind DB."
    );
  }
  return db;
}

export function d1BatchFirst<T>(
  result: D1Result<unknown> | D1Result<T> | undefined
): T | null {
  const row = result?.results?.[0];
  return (row as T | undefined) ?? null;
}
