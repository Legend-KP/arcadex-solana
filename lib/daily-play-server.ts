/**
 * D1 helpers for daily streak + shuffle (Solana).
 */

import { requireD1 } from "@/lib/d1-client";
import {
  SHUFFLE_DAILY_USDT_BUDGET_MICRO,
  microToUsdt,
  usdtToMicro,
  type ShuffleOutcomeDef,
} from "@/lib/shuffle-outcomes";

export function utcDayKey(now = Date.now()): string {
  return new Date(now).toISOString().slice(0, 10);
}

export type ShufflePendingPayload = {
  outcome: {
    id: string;
    type: "usdt" | "spark" | "none";
    amount: number | null;
    label: string;
  };
  reservedMicro: number;
  dayKey: string;
};

export type ShufflePendingRecord = {
  wallet: string;
  campaignId: string;
  nonce: string;
  payload: ShufflePendingPayload;
  consumedAt: number | null;
  txHash: string | null;
  createdAt: number;
};

export async function getShuffleUsdtBudgetRemainingMicro(
  dayKey = utcDayKey()
): Promise<number> {
  const db = await requireD1();
  const row = await db
    .prepare(
      `SELECT spent_micro FROM shuffle_daily_budget WHERE day_key = ?`
    )
    .bind(dayKey)
    .first<{ spent_micro: number }>();
  const spent = row?.spent_micro ?? 0;
  return Math.max(0, SHUFFLE_DAILY_USDT_BUDGET_MICRO - spent);
}

export async function getShuffleUsdtBudgetRemainingUsdt(
  dayKey = utcDayKey()
): Promise<number> {
  return microToUsdt(await getShuffleUsdtBudgetRemainingMicro(dayKey));
}

export function shuffleUsdtReservationKey(
  wallet: string,
  campaignId: string | number,
  nonce: string
): string {
  return `${wallet}:${campaignId}:${nonce}`;
}

/** Reserve USDT budget for a pending prize. Idempotent per reservation key. */
export async function reserveShuffleUsdtBudget(opts: {
  dayKey: string;
  micro: number;
  reservationKey: string;
}): Promise<boolean> {
  if (opts.micro <= 0) return true;
  const db = await requireD1();
  const row = await db
    .prepare(
      `SELECT spent_micro, reservations_json FROM shuffle_daily_budget WHERE day_key = ?`
    )
    .bind(opts.dayKey)
    .first<{ spent_micro: number; reservations_json: string }>();

  let spent = row?.spent_micro ?? 0;
  let reservations: Record<string, number> = {};
  try {
    reservations = row?.reservations_json
      ? (JSON.parse(row.reservations_json) as Record<string, number>)
      : {};
  } catch {
    reservations = {};
  }

  if (reservations[opts.reservationKey] != null) return true;
  if (spent + opts.micro > SHUFFLE_DAILY_USDT_BUDGET_MICRO) return false;

  reservations[opts.reservationKey] = opts.micro;
  spent += opts.micro;

  await db
    .prepare(
      `INSERT INTO shuffle_daily_budget (day_key, spent_micro, reservations_json, confirmed_json)
       VALUES (?, ?, ?, '{}')
       ON CONFLICT(day_key) DO UPDATE SET
         spent_micro = excluded.spent_micro,
         reservations_json = excluded.reservations_json`
    )
    .bind(opts.dayKey, spent, JSON.stringify(reservations))
    .run();
  return true;
}

export async function confirmShuffleUsdtBudget(opts: {
  dayKey: string;
  reservationKey: string;
  txHash: string;
}): Promise<void> {
  const db = await requireD1();
  const row = await db
    .prepare(
      `SELECT reservations_json, confirmed_json FROM shuffle_daily_budget WHERE day_key = ?`
    )
    .bind(opts.dayKey)
    .first<{ reservations_json: string; confirmed_json: string }>();
  if (!row) return;

  let reservations: Record<string, number> = {};
  let confirmed: Record<string, string> = {};
  try {
    reservations = JSON.parse(row.reservations_json || "{}");
  } catch {
    /* ignore */
  }
  try {
    confirmed = JSON.parse(row.confirmed_json || "{}");
  } catch {
    /* ignore */
  }
  confirmed[opts.reservationKey] = opts.txHash;
  await db
    .prepare(
      `UPDATE shuffle_daily_budget SET reservations_json = ?, confirmed_json = ? WHERE day_key = ?`
    )
    .bind(JSON.stringify(reservations), JSON.stringify(confirmed), opts.dayKey)
    .run();
}

export async function saveShufflePending(opts: {
  wallet: string;
  campaignId: string | number;
  nonce: string;
  payload: ShufflePendingPayload;
}): Promise<void> {
  const db = await requireD1();
  const now = Date.now();
  await db
    .prepare(
      `INSERT INTO shuffle_pending (wallet, campaign_id, nonce, payload_json, consumed_at, tx_hash, created_at)
       VALUES (?, ?, ?, ?, NULL, NULL, ?)
       ON CONFLICT(wallet, campaign_id, nonce) DO UPDATE SET
         payload_json = excluded.payload_json,
         created_at = excluded.created_at`
    )
    .bind(
      opts.wallet,
      String(opts.campaignId),
      opts.nonce,
      JSON.stringify(opts.payload),
      now
    )
    .run();
}

export async function getShufflePending(
  wallet: string,
  campaignId: string | number,
  nonce: string
): Promise<ShufflePendingRecord | null> {
  const db = await requireD1();
  const row = await db
    .prepare(
      `SELECT wallet, campaign_id, nonce, payload_json, consumed_at, tx_hash, created_at
       FROM shuffle_pending
       WHERE wallet = ? AND campaign_id = ? AND nonce = ?`
    )
    .bind(wallet, String(campaignId), nonce)
    .first<{
      wallet: string;
      campaign_id: string;
      nonce: string;
      payload_json: string;
      consumed_at: number | null;
      tx_hash: string | null;
      created_at: number;
    }>();
  if (!row) return null;
  let payload: ShufflePendingPayload;
  try {
    payload = JSON.parse(row.payload_json) as ShufflePendingPayload;
  } catch {
    return null;
  }
  return {
    wallet: row.wallet,
    campaignId: row.campaign_id,
    nonce: row.nonce,
    payload,
    consumedAt: row.consumed_at,
    txHash: row.tx_hash,
    createdAt: row.created_at,
  };
}

export async function consumeShufflePending(opts: {
  wallet: string;
  campaignId: string | number;
  nonce: string;
  txHash: string | null;
}): Promise<boolean> {
  const db = await requireD1();
  const now = Date.now();
  const result = await db
    .prepare(
      `UPDATE shuffle_pending
       SET consumed_at = ?, tx_hash = ?
       WHERE wallet = ? AND campaign_id = ? AND nonce = ? AND consumed_at IS NULL`
    )
    .bind(
      now,
      opts.txHash,
      opts.wallet,
      String(opts.campaignId),
      opts.nonce
    )
    .run();
  return (result.meta?.changes ?? 0) === 1;
}

/** Rolling 24h cooldown between shuffle plays (not calendar UTC midnight). */
export const SHUFFLE_COOLDOWN_MS = 24 * 60 * 60 * 1000;

export type ShuffleCompletionRow = {
  dayKey: string;
  outcomeId: string | null;
  payoutSignature: string | null;
  createdAt: number;
};

/** Most recent shuffle completion for this wallet/campaign (any day). */
export async function getLastShuffleCompletion(
  wallet: string,
  campaignId: string | number
): Promise<ShuffleCompletionRow | null> {
  const db = await requireD1();
  const row = await db
    .prepare(
      `SELECT day_key, outcome_id, payout_signature, created_at
       FROM daily_play_completions
       WHERE wallet = ? AND campaign_id = ? AND mode = 'shuffle'
       ORDER BY created_at DESC
       LIMIT 1`
    )
    .bind(wallet, String(campaignId))
    .first<{
      day_key: string;
      outcome_id: string | null;
      payout_signature: string | null;
      created_at: number;
    }>();
  if (!row) return null;
  return {
    dayKey: row.day_key,
    outcomeId: row.outcome_id,
    payoutSignature: row.payout_signature,
    createdAt: Number(row.created_at) || 0,
  };
}

/** Open (unclaimed) shuffle session from the last 24h, if any. */
export async function getOpenShufflePending(
  wallet: string,
  campaignId: string | number,
  now = Date.now()
): Promise<ShufflePendingRecord | null> {
  const db = await requireD1();
  const since = now - SHUFFLE_COOLDOWN_MS;
  const row = await db
    .prepare(
      `SELECT wallet, campaign_id, nonce, payload_json, consumed_at, tx_hash, created_at
       FROM shuffle_pending
       WHERE wallet = ? AND campaign_id = ? AND consumed_at IS NULL AND created_at >= ?
       ORDER BY created_at DESC
       LIMIT 1`
    )
    .bind(wallet, String(campaignId), since)
    .first<{
      wallet: string;
      campaign_id: string;
      nonce: string;
      payload_json: string;
      consumed_at: number | null;
      tx_hash: string | null;
      created_at: number;
    }>();
  if (!row) return null;
  let payload: ShufflePendingPayload;
  try {
    payload = JSON.parse(row.payload_json) as ShufflePendingPayload;
  } catch {
    return null;
  }
  return {
    wallet: row.wallet,
    campaignId: row.campaign_id,
    nonce: row.nonce,
    payload,
    consumedAt: row.consumed_at,
    txHash: row.tx_hash,
    createdAt: row.created_at,
  };
}

/** True when a shuffle was fully claimed within the last 24 hours. */
export async function hasCompletedShuffleToday(
  wallet: string,
  campaignId: string | number,
  now = Date.now()
): Promise<boolean> {
  const last = await getLastShuffleCompletion(wallet, campaignId);
  return Boolean(last && now - last.createdAt < SHUFFLE_COOLDOWN_MS);
}

/**
 * Whether the Daily Jackpot UI should appear.
 * - Show for a fresh play (no completion in 24h, no open pending)
 * - Show to resume an unclaimed pending prize
 * - Hide after a successful claim until 24h elapses
 */
export async function getShuffleAvailability(
  wallet: string,
  campaignId: string | number,
  now = Date.now()
): Promise<{
  canCheckIn: boolean;
  lastCheckInAt: number;
  nextAvailableAt: number;
  openNonce: string | null;
}> {
  const last = await getLastShuffleCompletion(wallet, campaignId);
  const open = await getOpenShufflePending(wallet, campaignId, now);

  if (last && now - last.createdAt < SHUFFLE_COOLDOWN_MS && !open) {
    return {
      canCheckIn: false,
      lastCheckInAt: last.createdAt,
      nextAvailableAt: last.createdAt + SHUFFLE_COOLDOWN_MS,
      openNonce: null,
    };
  }

  if (open) {
    return {
      canCheckIn: true,
      lastCheckInAt: open.createdAt,
      nextAvailableAt: open.createdAt + SHUFFLE_COOLDOWN_MS,
      openNonce: open.nonce,
    };
  }

  return {
    canCheckIn: true,
    lastCheckInAt: last?.createdAt ?? 0,
    nextAvailableAt: 0,
    openNonce: null,
  };
}

export async function markShuffleCompletedToday(opts: {
  wallet: string;
  campaignId: string | number;
  dayKey?: string;
  outcomeId: string;
  payoutSignature?: string | null;
}): Promise<void> {
  const db = await requireD1();
  const dayKey = opts.dayKey ?? utcDayKey();
  const now = Date.now();
  await db
    .prepare(
      `INSERT OR IGNORE INTO daily_play_completions
         (wallet, campaign_id, day_key, mode, outcome_id, payout_signature, created_at)
       VALUES (?, ?, ?, 'shuffle', ?, ?, ?)`
    )
    .bind(
      opts.wallet,
      String(opts.campaignId),
      dayKey,
      opts.outcomeId,
      opts.payoutSignature ?? null,
      now
    )
    .run();
}

/* ─── Streak (D1, inactive until DAILY_PLAY_MODE=streak) ─────────────────── */

export type StreakProgressRow = {
  wallet: string;
  campaignId: string;
  currentDay: number;
  lastCheckInAt: number;
  lastCheckInDayKey: string;
  requiredDays: number;
  milestoneClaimed: boolean;
};

const DEFAULT_STREAK_REQUIRED_DAYS = 7;
const STREAK_INTERVAL_MS = 20 * 60 * 60 * 1000; // 20h like typical daily windows

export async function getStreakProgress(
  wallet: string,
  campaignId: string | number
): Promise<StreakProgressRow> {
  const db = await requireD1();
  const row = await db
    .prepare(
      `SELECT wallet, campaign_id, current_day, last_check_in_at, last_check_in_day_key,
              required_days, milestone_claimed
       FROM streak_progress WHERE wallet = ? AND campaign_id = ?`
    )
    .bind(wallet, String(campaignId))
    .first<{
      wallet: string;
      campaign_id: string;
      current_day: number;
      last_check_in_at: number;
      last_check_in_day_key: string;
      required_days: number;
      milestone_claimed: number;
    }>();

  if (!row) {
    return {
      wallet,
      campaignId: String(campaignId),
      currentDay: 0,
      lastCheckInAt: 0,
      lastCheckInDayKey: "",
      requiredDays: DEFAULT_STREAK_REQUIRED_DAYS,
      milestoneClaimed: false,
    };
  }
  return {
    wallet: row.wallet,
    campaignId: row.campaign_id,
    currentDay: row.current_day,
    lastCheckInAt: row.last_check_in_at,
    lastCheckInDayKey: row.last_check_in_day_key,
    requiredDays: row.required_days || DEFAULT_STREAK_REQUIRED_DAYS,
    milestoneClaimed: Boolean(row.milestone_claimed),
  };
}

export function deriveStreakStatus(progress: StreakProgressRow, now = Date.now()) {
  const dayKey = utcDayKey(now);
  const alreadyToday = progress.lastCheckInDayKey === dayKey;
  const gapTooLong =
    progress.lastCheckInAt > 0 &&
    now - progress.lastCheckInAt > STREAK_INTERVAL_MS * 2;
  const streakWouldReset =
    !alreadyToday && progress.currentDay > 0 && gapTooLong;
  const canCheckIn = !alreadyToday;
  return {
    currentDay: progress.currentDay,
    requiredDays: progress.requiredDays,
    lastCheckInAt: progress.lastCheckInAt,
    canCheckIn,
    streakWouldReset,
    milestoneClaimed: progress.milestoneClaimed,
    dayKey,
  };
}

export async function applyStreakCheckIn(
  wallet: string,
  campaignId: string | number,
  now = Date.now()
): Promise<{
  currentDay: number;
  requiredDays: number;
  milestone: boolean;
  lastCheckInAt: number;
}> {
  const progress = await getStreakProgress(wallet, campaignId);
  const status = deriveStreakStatus(progress, now);
  if (!status.canCheckIn) {
    throw new Error("Already checked in today.");
  }

  const nextDay = status.streakWouldReset ? 1 : progress.currentDay + 1;
  const required = progress.requiredDays || DEFAULT_STREAK_REQUIRED_DAYS;
  const milestone = nextDay >= required && !progress.milestoneClaimed;
  const dayKey = utcDayKey(now);
  const db = await requireD1();

  await db
    .prepare(
      `INSERT INTO streak_progress
         (wallet, campaign_id, current_day, last_check_in_at, last_check_in_day_key,
          required_days, milestone_claimed, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(wallet, campaign_id) DO UPDATE SET
         current_day = excluded.current_day,
         last_check_in_at = excluded.last_check_in_at,
         last_check_in_day_key = excluded.last_check_in_day_key,
         updated_at = excluded.updated_at`
    )
    .bind(
      wallet,
      String(campaignId),
      nextDay >= required ? 0 : nextDay,
      now,
      dayKey,
      required,
      milestone || progress.milestoneClaimed ? 1 : 0,
      now
    )
    .run();

  await db
    .prepare(
      `INSERT OR IGNORE INTO daily_play_completions
         (wallet, campaign_id, day_key, mode, outcome_id, payout_signature, created_at)
       VALUES (?, ?, ?, 'streak', ?, NULL, ?)`
    )
    .bind(
      wallet,
      String(campaignId),
      dayKey,
      milestone ? "milestone" : `day_${nextDay}`,
      now
    )
    .run();

  return {
    currentDay: nextDay >= required ? required : nextDay,
    requiredDays: required,
    milestone,
    lastCheckInAt: now,
  };
}

export async function markStreakMilestoneClaimed(
  wallet: string,
  campaignId: string | number
): Promise<void> {
  const db = await requireD1();
  await db
    .prepare(
      `UPDATE streak_progress SET milestone_claimed = 1, updated_at = ?
       WHERE wallet = ? AND campaign_id = ?`
    )
    .bind(Date.now(), wallet, String(campaignId))
    .run();
}

export function outcomePayloadFromDef(
  outcome: ShuffleOutcomeDef,
  dayKey: string,
  reservedMicro: number
): ShufflePendingPayload {
  return {
    outcome: {
      id: outcome.id,
      type: outcome.type,
      amount: outcome.amount,
      label: outcome.label,
    },
    reservedMicro,
    dayKey,
  };
}

export { usdtToMicro };
