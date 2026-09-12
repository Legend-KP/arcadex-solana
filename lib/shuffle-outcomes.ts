import { randomInt } from "crypto";
import {
  REWARD_OFFCHAIN,
  REWARD_USDT,
} from "@/lib/arcadex-rewards";

/** USDT on Celo uses 6 decimals. */
export const USDT_DECIMALS = 6;

/**
 * Hard daily USDT spend ceiling (human units). Must be ≥ jackpot (1) so the
 * 1 USDT prize can still pay. Soft odds target ~0.35 on non-jackpot days at
 * 10k shuffles; the hard gate stops further USDT once this is hit.
 */
export const SHUFFLE_DAILY_USDT_BUDGET = Number(
  process.env.SHUFFLE_DAILY_USDT_BUDGET?.trim() || "1"
);

/** Integer micro-USDT (6 decimals) helpers for budget math. */
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
  /** Display amount for USDT (human units). */
  amount: number | null;
  /** Relative integer weight (sum = SHUFFLE_WEIGHT_TOTAL). */
  weight: number;
  label: string;
  sub: string;
  glyph: string;
  rarity: "legendary" | "rare" | "uncommon" | "spark" | "none";
}

/**
 * Weight base chosen so rare odds are exact integers:
 * 1/15k, 1/10k, 1/2k all divide 30_000.
 *
 * At 10k daily shuffles (soft EV, before hard daily cap):
 * - 1 USDT @ 1/15k     → ~0.67 expected (often blocked by daily cap)
 * - 0.05 USDT @ 1/10k  → ~0.05
 * - 0.001 USDT @ 3%    → ~0.30  (maximizes unique USDT winners)
 * - Infinite Spark @ 1/2k → ~5 winners
 * Non-jackpot USDT ≈ 0.35/day; hard cap clamps total spend to budget.
 */
export const SHUFFLE_WEIGHT_TOTAL = 30_000;

/**
 * Server-only odds table. Client may mirror labels for theater, but never
 * trust a client-supplied outcome.
 */
export const SHUFFLE_OUTCOMES: ShuffleOutcomeDef[] = [
  {
    id: "usdt_1",
    type: "usdt",
    amount: 1,
    weight: 2, // 2/30000 = 1/15000
    label: "1 USDT",
    sub: "Jackpot",
    glyph: "Ⓤ",
    rarity: "legendary",
  },
  {
    id: "usdt_p05",
    type: "usdt",
    amount: 0.05,
    weight: 3, // 3/30000 = 1/10000
    label: "0.05 USDT",
    sub: "Big win",
    glyph: "Ⓤ",
    rarity: "rare",
  },
  {
    id: "usdt_p001",
    type: "usdt",
    amount: 0.001,
    weight: 900, // 900/30000 = 3%
    label: "0.001 USDT",
    sub: "Small win",
    glyph: "Ⓤ",
    rarity: "uncommon",
  },
  {
    id: "spark",
    type: "spark",
    amount: null,
    weight: 15, // 15/30000 = 1/2000
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

/**
 * Pick an outcome. USDT prizes that cannot fit in the remaining daily budget
 * are excluded so more users can still win smaller amounts within the cap.
 */
export function pickShuffleOutcome(opts: {
  /** Remaining daily USDT budget in human units. */
  remainingUsdt: number;
}): ShuffleOutcomeDef {
  const remainingMicro = usdtToMicro(opts.remainingUsdt);
  const pool = SHUFFLE_OUTCOMES.filter((o) => {
    if (o.type !== "usdt") return true;
    if (o.amount == null) return false;
    return usdtToMicro(o.amount) <= remainingMicro;
  });
  return secureWeightedPick(pool.length > 0 ? pool : SHUFFLE_OUTCOMES.filter((o) => o.type !== "usdt"));
}

export function outcomeToOnChainReward(outcome: ShuffleOutcomeDef): {
  rewardMode: number;
  rewardTarget: `0x${string}`;
  rewardAmount: bigint;
} {
  if (outcome.type === "usdt" && outcome.amount != null) {
    return {
      rewardMode: REWARD_USDT,
      rewardTarget: "0x48065fbBE25f71C9282ddf5e1cD6D6A887483D5e",
      rewardAmount: usdtToBaseUnits(outcome.amount),
    };
  }
  return {
    rewardMode: REWARD_OFFCHAIN,
    rewardTarget: "0x0000000000000000000000000000000000000000",
    rewardAmount: BigInt(0),
  };
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
