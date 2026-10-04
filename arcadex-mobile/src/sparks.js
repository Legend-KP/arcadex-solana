import AsyncStorage from "@react-native-async-storage/async-storage";

const SPARK_KEY = "arcadex_guest_sparks";
export const SPARK_MAX = 4;
export const SPARK_REGEN_MS = 180 * 60 * 1000;
export const INFINITE_SPARK_DURATION_MS = 24 * 60 * 60 * 1000;

export function defaultSparkState() {
  return {
    max: SPARK_MAX,
    regenMs: SPARK_REGEN_MS,
    slots: Array.from({ length: SPARK_MAX }, () => null),
  };
}

export function normalizeSparkState(raw, now = Date.now()) {
  const defaults = defaultSparkState();
  if (!raw || typeof raw !== "object") return defaults;
  const max =
    typeof raw.max === "number" && raw.max > 0
      ? Math.max(Math.floor(raw.max), SPARK_MAX)
      : defaults.max;
  const regenMs =
    typeof raw.regenMs === "number" && raw.regenMs > 0
      ? raw.regenMs
      : defaults.regenMs;
  const slots = Array.from({ length: max }, (_, i) => {
    const v = Array.isArray(raw.slots) ? raw.slots[i] : null;
    if (v === null || v === undefined || v === 0) return null;
    const n = Number(v);
    if (!Number.isFinite(n) || n <= now) return null;
    return n;
  });
  const infiniteUntil =
    typeof raw.infiniteUntil === "number" && raw.infiniteUntil > now
      ? raw.infiniteUntil
      : undefined;
  return {
    max,
    regenMs,
    slots,
    ...(infiniteUntil ? { infiniteUntil } : {}),
  };
}

export function snapshotSparks(state, now = Date.now()) {
  const normalized = normalizeSparkState(state, now);
  const hasInfinite = Boolean(
    normalized.infiniteUntil && normalized.infiniteUntil > now
  );
  const available = hasInfinite
    ? normalized.max
    : normalized.slots.filter((s) => s === null).length;
  return {
    state: normalized,
    available,
    max: normalized.max,
    hasInfinite,
    infiniteUntil: normalized.infiniteUntil || 0,
  };
}

export function applyRefill(state) {
  const normalized = normalizeSparkState(state);
  return {
    ...normalized,
    slots: Array.from({ length: normalized.max }, () => null),
  };
}

export function applyInfinite(state, now = Date.now()) {
  const normalized = normalizeSparkState(state, now);
  const baseUntil =
    normalized.infiniteUntil && normalized.infiniteUntil > now
      ? normalized.infiniteUntil
      : now;
  return {
    ...normalized,
    infiniteUntil: baseUntil + INFINITE_SPARK_DURATION_MS,
  };
}

export async function loadSparkState() {
  try {
    const raw = await AsyncStorage.getItem(SPARK_KEY);
    if (!raw) {
      const fresh = defaultSparkState();
      await AsyncStorage.setItem(SPARK_KEY, JSON.stringify(fresh));
      return snapshotSparks(fresh);
    }
    const parsed = JSON.parse(raw);
    const snap = snapshotSparks(parsed);
    await AsyncStorage.setItem(SPARK_KEY, JSON.stringify(snap.state));
    return snap;
  } catch {
    return snapshotSparks(defaultSparkState());
  }
}

export async function saveSparkState(state) {
  const snap = snapshotSparks(state);
  await AsyncStorage.setItem(SPARK_KEY, JSON.stringify(snap.state));
  return snap;
}

export async function grantSparkPurpose(purpose) {
  const current = await loadSparkState();
  if (purpose === "spark_refill") {
    return saveSparkState(applyRefill(current.state));
  }
  if (purpose === "infinite_spark") {
    return saveSparkState(applyInfinite(current.state));
  }
  return current;
}

export async function importSparkStateJson(json) {
  if (!json) return loadSparkState();
  try {
    const parsed = JSON.parse(json);
    return saveSparkState(parsed);
  } catch {
    return loadSparkState();
  }
}

export function sparkStateJsonForInject(state) {
  return JSON.stringify(normalizeSparkState(state));
}
