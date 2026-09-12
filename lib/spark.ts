import { SparkSlotView, SparkSnapshot, StoredSparkState } from "@/types";

export const SPARK_MAX = 4;
export const SPARK_REGEN_MS = 180 * 60 * 1000;

export function defaultSparkState(): StoredSparkState {
  return {
    max: SPARK_MAX,
    regenMs: SPARK_REGEN_MS,
    slots: Array.from({ length: SPARK_MAX }, () => null),
  };
}

function coerceSlotValue(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "number" && Number.isFinite(value)) {
    // 0 = ready (Firebase RTDB strips nulls, so ready slots are stored as 0).
    return value <= 0 ? null : value;
  }
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed <= 0 ? null : parsed;
  }
  return null;
}

/** Ready slots as 0 so Firebase RTDB PUT does not delete them (null = delete). */
export function sparkStateForRtdb(state: StoredSparkState): StoredSparkState {
  return {
    max: state.max,
    regenMs: state.regenMs,
    slots: state.slots.map((slot) => (slot === null ? 0 : slot)),
    ...(state.infiniteUntil ? { infiniteUntil: state.infiniteUntil } : {}),
  };
}

/** RTDB may return arrays as `{0:…,1:…}` objects or omit fields entirely. */
function coerceSlots(raw: unknown, max: number): (number | null)[] {
  if (Array.isArray(raw)) {
    const slots = raw.slice(0, max).map(coerceSlotValue);
    while (slots.length < max) slots.push(null);
    return slots;
  }

  if (raw && typeof raw === "object") {
    const record = raw as Record<string, unknown>;
    const slots: (number | null)[] = [];
    for (let i = 0; i < max; i++) {
      slots.push(coerceSlotValue(record[i] ?? record[String(i)]));
    }
    return slots;
  }

  return Array.from({ length: max }, () => null);
}

export function coerceSparkState(raw: unknown): StoredSparkState {
  const defaults = defaultSparkState();
  if (!raw || typeof raw !== "object") return defaults;

  const data = raw as Partial<StoredSparkState>;
  // Always at least SPARK_MAX so raising the global cap upgrades existing users.
  const storedMax =
    typeof data.max === "number" && data.max > 0
      ? Math.floor(data.max)
      : defaults.max;
  const max = Math.max(storedMax, SPARK_MAX);
  const regenMs =
    typeof data.regenMs === "number" && data.regenMs > 0
      ? data.regenMs
      : defaults.regenMs;
  const slots = coerceSlots(data.slots, max);
  const infiniteUntil =
    typeof data.infiniteUntil === "number" && Number.isFinite(data.infiniteUntil)
      ? data.infiniteUntil
      : undefined;

  return {
    max,
    regenMs,
    slots,
    ...(infiniteUntil ? { infiniteUntil } : {}),
  };
}

/** Rightmost ready slot. */
export function findReadySparkSlotIndex(
  slots: (number | null)[],
  now = Date.now()
): number {
  for (let i = slots.length - 1; i >= 0; i--) {
    const slot = slots[i];
    if (slot === null || slot <= now) return i;
  }
  return -1;
}

/**
 * Sequential refill: only one Spark regenerates at a time.
 * A newly spent Spark becomes ready at `latestPendingReadyAt + regenMs`
 * (or `now + regenMs` if nothing is regenerating).
 */
export function nextSequentialReadyAt(
  slots: (number | null)[],
  now: number,
  regenMs: number
): number {
  let latestPending = now;
  for (const slot of slots) {
    if (slot !== null && slot > now) {
      latestPending = Math.max(latestPending, slot);
    }
  }
  return latestPending + regenMs;
}

/**
 * Rewrite pending readyAts so they are spaced exactly `regenMs` apart.
 * Migrates old parallel timers (many slots sharing ~the same readyAt).
 */
export function rechainSparkSlots(
  slots: (number | null)[],
  now: number,
  regenMs: number
): (number | null)[] {
  const pendingIndexes: number[] = [];
  for (let i = 0; i < slots.length; i++) {
    const slot = slots[i];
    if (slot !== null && slot > now) pendingIndexes.push(i);
  }
  if (pendingIndexes.length <= 1) return slots;

  pendingIndexes.sort((a, b) => (slots[a] as number) - (slots[b] as number));

  const next = [...slots];
  let cursor = slots[pendingIndexes[0]] as number;
  next[pendingIndexes[0]] = cursor;
  for (let i = 1; i < pendingIndexes.length; i++) {
    cursor += regenMs;
    next[pendingIndexes[i]] = cursor;
  }
  return next;
}

/** Spend one ready Spark and enqueue its sequential regen timer. */
export function applySparkSpend(
  state: StoredSparkState,
  now = Date.now()
): StoredSparkState | null {
  const normalized = normalizeSparkState(state, now);
  const readyIndex = findReadySparkSlotIndex(normalized.slots, now);
  if (readyIndex === -1) return null;

  const slots = [...normalized.slots];
  slots[readyIndex] = nextSequentialReadyAt(
    normalized.slots,
    now,
    normalized.regenMs
  );

  return {
    ...normalized,
    slots,
  };
}

/** Normalize expired regen timestamps and enforce sequential chaining. */
export function normalizeSparkState(
  raw: StoredSparkState | unknown,
  now = Date.now()
): StoredSparkState {
  const state = coerceSparkState(raw);
  const expired = state.slots.map((slot) =>
    slot !== null && slot <= now ? null : slot
  );
  const slots = rechainSparkSlots(expired, now, state.regenMs);
  const infiniteUntil =
    state.infiniteUntil && state.infiniteUntil > now
      ? state.infiniteUntil
      : undefined;

  return {
    max: state.max,
    regenMs: state.regenMs,
    slots,
    ...(infiniteUntil ? { infiniteUntil } : {}),
  };
}

function slotFill(
  readyAt: number | null,
  now: number,
  regenMs: number
): number {
  if (readyAt === null || now >= readyAt) return 1;
  const remaining = readyAt - now;
  // Queued slots (waiting for the previous Spark) have not started filling.
  if (remaining >= regenMs) return 0;
  return 1 - remaining / regenMs;
}

function slotStatus(
  readyAt: number | null,
  now: number,
  regenMs: number
): SparkSlotView["status"] {
  if (readyAt === null || now >= readyAt) return "ready";
  return readyAt - now > regenMs ? "queued" : "regenerating";
}

export function computeSparkSnapshot(
  raw: StoredSparkState,
  now = Date.now()
): SparkSnapshot {
  const state = normalizeSparkState(raw, now);
  const { max, regenMs, slots } = state;

  const available = slots.filter(
    (slot) => slot === null || slot <= now
  ).length;

  let fillSum = 0;
  for (const slot of slots) {
    fillSum += slotFill(slot, now, regenMs);
  }
  const fillLevel = fillSum / max;
  const fillPercent = Math.min(100, Math.max(0, fillLevel * 100));

  const pending = slots
    .filter((slot): slot is number => slot !== null && slot > now)
    .sort((a, b) => a - b);
  const timeToFullMs =
    pending.length === 0 ? 0 : pending[pending.length - 1] - now;
  const timeToNextMs = pending.length === 0 ? 0 : pending[0] - now;

  const slotViews: SparkSlotView[] = slots.map((slot, index) => {
    const status = slotStatus(slot, now, regenMs);
    if (status === "ready") {
      return {
        index,
        status,
        fillPercent: 100,
        timeRemainingMs: 0,
      };
    }
    const timeRemainingMs = (slot as number) - now;
    return {
      index,
      status,
      fillPercent: Math.round(slotFill(slot, now, regenMs) * 100),
      timeRemainingMs,
    };
  });

  const hasInfinite = Boolean(
    state.infiniteUntil && state.infiniteUntil > now
  );

  return {
    max,
    available,
    fillPercent,
    timeToFullMs,
    timeToNextMs,
    slots: slotViews,
    regeneratingCount: pending.length,
    hasInfinite,
    ...(hasInfinite ? { infiniteUntil: state.infiniteUntil } : {}),
  };
}

export function formatSparkDuration(ms: number): string {
  if (ms <= 0) return "Ready now";

  const totalMinutes = Math.ceil(ms / 60_000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;

  if (hours > 0 && minutes > 0) return `${hours}h ${minutes}m`;
  if (hours > 0) return `${hours}h`;
  return `${minutes}m`;
}

export function formatSparkCountdown(ms: number): string {
  if (ms <= 0) return "Ready now";

  const totalSeconds = Math.max(0, Math.ceil(ms / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) {
    return `${hours}h ${minutes.toString().padStart(2, "0")}m ${seconds.toString().padStart(2, "0")}s`;
  }
  if (minutes > 0) {
    return `${minutes}m ${seconds.toString().padStart(2, "0")}s`;
  }
  return `${seconds}s`;
}
