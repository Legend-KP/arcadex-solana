import {
  applySparkSpend,
  computeSparkSnapshot,
  defaultSparkState,
  normalizeSparkState,
  SPARK_REGEN_MS,
} from "../lib/spark";

const t0 = 1_700_000_000_000;
let state = defaultSparkState();

state = applySparkSpend(state, t0)!;
console.log(
  "after spend1 offsets",
  state.slots.map((s) => (s === null ? null : s - t0))
);

state = applySparkSpend(state, t0 + 60 * 60 * 1000)!;
console.log(
  "after spend2 +1h offsets",
  state.slots.map((s) => (s === null ? null : s - t0))
);

const snap1h = computeSparkSnapshot(state, t0 + 60 * 60 * 1000);
console.log(
  "snap +1h",
  snap1h.available,
  snap1h.slots.map((s) => ({ status: s.status, rem: s.timeRemainingMs }))
);

const snap3h = computeSparkSnapshot(state, t0 + SPARK_REGEN_MS);
console.log(
  "snap +3h",
  snap3h.available,
  snap3h.slots.map((s) => ({ status: s.status, rem: s.timeRemainingMs }))
);

let empty = defaultSparkState();
for (let i = 0; i < 4; i++) empty = applySparkSpend(empty, t0)!;
console.log(
  "empty4 multiples",
  empty.slots.map((s) => (s === null ? null : (s - t0) / SPARK_REGEN_MS))
);
console.log(
  "empty to full hours",
  computeSparkSnapshot(empty, t0).timeToFullMs / SPARK_REGEN_MS
);

const parallel = normalizeSparkState(
  {
    max: 4,
    regenMs: SPARK_REGEN_MS,
    slots: [
      t0 + SPARK_REGEN_MS,
      t0 + SPARK_REGEN_MS,
      t0 + SPARK_REGEN_MS,
      t0 + SPARK_REGEN_MS,
    ],
  },
  t0
);
console.log(
  "migrated parallel",
  parallel.slots.map((s) => (s === null ? null : (s - t0) / SPARK_REGEN_MS))
);

// Assertions
const spend2ReadyAts = state.slots
  .filter((s): s is number => s !== null)
  .sort((a, b) => a - b);
if (spend2ReadyAts[0] !== t0 + SPARK_REGEN_MS) {
  throw new Error("first spark should still finish at t0+3h");
}
if (spend2ReadyAts[1] !== t0 + 2 * SPARK_REGEN_MS) {
  throw new Error("second spark should finish at t0+6h (queued)");
}
if (snap1h.available !== 2) throw new Error("expected 2 available after 2 spends");
if (snap3h.available !== 3) throw new Error("expected 3 available at t0+3h");
const regenerating = snap3h.slots.filter((s) => s.status === "regenerating");
const queued = snap3h.slots.filter((s) => s.status === "queued");
if (regenerating.length !== 1) throw new Error("exactly one regenerating at +3h");
if (queued.length !== 0) throw new Error("no queued at +3h after first finished");
if (computeSparkSnapshot(empty, t0).timeToFullMs !== 4 * SPARK_REGEN_MS) {
  throw new Error("empty bar should take 12h to fill");
}
console.log("OK: sequential spark refill assertions passed");
