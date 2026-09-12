/**
 * Guard-record archival (payment / reward replay markers).
 *
 * Paths:
 *   sparkPayments/{txHash}
 *   scorePayments/{txHash}
 *   checkInTxs/{txHash}
 *   streakGrants/{txHash}
 *
 * CRITICAL CORRECTION vs earlier draft:
 * Do NOT delete these markers from RTDB. On-chain transactions remain
 * verifiable forever — removing the "used" marker makes old txs replayable.
 *
 * Correct plan (when storage cost matters):
 * 1. Optionally export bulky metadata (scores, timestamps, campaign fields)
 *    older than ~90 days to cold storage (R2 / GCS / BigQuery).
 * 2. KEEP a permanent minimal marker in RTDB forever, e.g.:
 *      sparkPayments/{txHash} = { wallet: "0x...", used: true }
 *    or even just `true` / `{ w: "0x.." }` — enough to block replay.
 * 3. Never delete the marker node itself.
 *
 * Do not wire a cron that deletes these keys.
 */

export const GUARD_ARCHIVE_ROOTS = [
  "sparkPayments",
  "scorePayments",
  "checkInTxs",
  "streakGrants",
] as const;

/** Age after which bulky metadata may be slimmed — markers still stay forever. */
export const GUARD_METADATA_COLD_AGE_MS = 90 * 24 * 60 * 60 * 1000;

export function isGuardMetadataCold(
  record: { activatedAt?: number; syncedAt?: number; grantedAt?: number },
  now = Date.now()
): boolean {
  const ts = record.activatedAt ?? record.syncedAt ?? record.grantedAt;
  if (typeof ts !== "number" || !Number.isFinite(ts)) return false;
  return now - ts > GUARD_METADATA_COLD_AGE_MS;
}

/** Minimal forever marker — never delete from RTDB. */
export type GuardForeverMarker = {
  wallet: string;
  used: true;
};

export function toForeverMarker(wallet: string): GuardForeverMarker {
  return { wallet, used: true };
}

/**
 * Placeholder — when implemented: export cold metadata, then REPLACE the RTDB
 * value with `toForeverMarker(wallet)` (slim), never DELETE the key.
 */
export async function slimExpiredGuardMetadata(): Promise<{
  scanned: number;
  slimmed: number;
}> {
  throw new Error(
    "slimExpiredGuardMetadata is not implemented yet. See lib/archive-rtdb-guards.ts — markers must never be deleted."
  );
}
