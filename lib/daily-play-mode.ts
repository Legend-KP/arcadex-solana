export type DailyPlayMode = "streak" | "shuffle";

export const DEFAULT_STREAK_CAMPAIGN_ID = Number(
  process.env.STREAK_CAMPAIGN_ID?.trim() ||
    process.env.NEXT_PUBLIC_STREAK_CAMPAIGN_ID?.trim() ||
    "1"
);

export const DEFAULT_SHUFFLE_CAMPAIGN_ID = Number(
  process.env.SHUFFLE_CAMPAIGN_ID?.trim() ||
    process.env.NEXT_PUBLIC_SHUFFLE_CAMPAIGN_ID?.trim() ||
    "3"
);

/**
 * Server + build-time mode.
 * Cloudflare: set `DAILY_PLAY_MODE=streak` (runtime) and/or
 * `NEXT_PUBLIC_DAILY_PLAY_MODE=streak` (must rebuild for client inlining).
 *
 * Default is **streak** (7-day Daily Streak). Shuffle code remains but stays dormant
 * unless you explicitly set `DAILY_PLAY_MODE=shuffle`.
 */
export function getDailyPlayMode(): DailyPlayMode {
  const mode = (
    process.env.DAILY_PLAY_MODE?.trim() ||
    process.env.NEXT_PUBLIC_DAILY_PLAY_MODE?.trim() ||
    "streak"
  ).toLowerCase();
  return mode === "shuffle" ? "shuffle" : "streak";
}

export function isShuffleDailyPlay(): boolean {
  return getDailyPlayMode() === "shuffle";
}

/** Campaign used for today's daily sign-in ceremony. */
export function getDailyCampaignId(): number {
  return isShuffleDailyPlay()
    ? DEFAULT_SHUFFLE_CAMPAIGN_ID
    : DEFAULT_STREAK_CAMPAIGN_ID;
}

export type DailyPlayConfig = {
  mode: DailyPlayMode;
  campaignId: number;
  shuffle: boolean;
  /** Streak UI/APIs exist but are not opened when false. */
  streakActive: boolean;
};
