import { randomInt } from "crypto";

/** USDT on Solana uses 6 decimals. */
export const USDT_DECIMALS = 6;

/**
 * Hard daily USDT spend ceiling (human units). Must be ≥ jackpot (1) so the
 * 1 USDT prize can still pay.
 *
 * Env: SHUFFLE_DAILY_USDT_BUDGET (default "1")
 */
export const SHUFFLE_DAILY_USDT_BUDGET = Number(
  process.env.SHUFFLE_DAILY_USDT_BUDGET?.trim() || "1"
);

export function usdtToMicro(amount: number): number {
  return Math.round(amount * 10 ** USDT_DECIMALS);
}

export function microToUsdt(micro: number): number {
  return micro / 10 ** USDT_DECIMALS;
}

export const SHUFFLE_DAILY_USDT_BUDGET_MICRO = usdtToMicro(
  SHUFFLE_DAILY_USDT_BUDGET
);

export type ShuffleOutcomeType = "usdt" | "spark" | "none";

export interface ShuffleOutcomeDef {
  id: string;
  type: ShuffleOutcomeType;
  amount: number | null;
  weight: number;
  label: string;
  sub: string;
  glyph: string;
  rarity: "legendary" | "rare" | "uncommon" | "spark" | "none";
}

export const SHUFFLE_WEIGHT_TOTAL = 30_000;

/** Server-only odds table. Never trust a client-supplied outcome. */
export const SHUFFLE_OUTCOMES: ShuffleOutcomeDef[] = [
  {
    id: "usdt_1",
    type: "usdt",
    amount: 1,
    weight: 2,
    label: "1 USDT",
    sub: "Jackpot",
    glyph: "Ⓤ",
    rarity: "legendary",
  },
  {
    id: "usdt_p05",
    type: "usdt",
    amount: 0.05,
    weight: 3,
    label: "0.05 USDT",
    sub: "Big win",
    glyph: "Ⓤ",
    rarity: "rare",
  },
  {
    id: "usdt_p001",
    type: "usdt",
    amount: 0.001,
    weight: 900,
    label: "0.001 USDT",
    sub: "Small win",
    glyph: "Ⓤ",
    rarity: "uncommon",
  },
  {
    id: "spark",
    type: "spark",
    amount: null,
    weight: 15,
    label: "Infinite Spark",
    sub: "Unlimited plays · 24h",
    glyph: "⚡",
    rarity: "spark",
  },
  {
    id: "blnt1",
    type: "none",
    amount: null,
    weight: 14_540,
    label: "Better luck next time",
    sub: "Try again tomorrow",
    glyph: "✦",
    rarity: "none",
  },
  {
    id: "blnt2",
    type: "none",
    amount: null,
    weight: 14_540,
    label: "Better luck next time",
    sub: "So close!",
    glyph: "✦",
    rarity: "none",
  },
];

export function usdtToBaseUnits(amount: number): bigint {
  return BigInt(usdtToMicro(amount));
}

export function secureWeightedPick(
  outcomes: ShuffleOutcomeDef[] = SHUFFLE_OUTCOMES
): ShuffleOutcomeDef {
  if (outcomes.length === 0) {
    throw new Error("No shuffle outcomes available.");
  }
  const total = outcomes.reduce((a, o) => a + o.weight, 0);
  if (total <= 0) {
    throw new Error("Shuffle outcome weights must be positive.");
  }
  const roll = randomInt(0, total);
  let cursor = 0;
  for (let i = 0; i < outcomes.length; i++) {
    cursor += outcomes[i].weight;
    if (roll < cursor) return outcomes[i];
  }
  return outcomes[outcomes.length - 1];
}

export function pickShuffleOutcome(opts: {
  remainingUsdt: number;
}): ShuffleOutcomeDef {
  const remainingMicro = usdtToMicro(opts.remainingUsdt);
  const pool = SHUFFLE_OUTCOMES.filter((o) => {
    if (o.type !== "usdt") return true;
    if (o.amount == null) return false;
    return usdtToMicro(o.amount) <= remainingMicro;
  });
  return secureWeightedPick(
    pool.length > 0 ? pool : SHUFFLE_OUTCOMES.filter((o) => o.type !== "usdt")
  );
}

/** Public labels for the theater grid (no weights). */
export function getShuffleTheaterCards() {
  return SHUFFLE_OUTCOMES.map(
    ({ id, type, amount, label, sub, glyph, rarity }) => ({
      id,
      type,
      amount,
      label,
      sub,
      glyph,
      rarity,
    })
  );
}
