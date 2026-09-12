import {
  DEFAULT_STREAK_CAMPAIGN_ID,
} from "@/lib/arcadex-rewards";

export type DailyPlayMode = "streak" | "shuffle";

/**
 * Server + build-time mode.
 * Cloudflare: set `DAILY_PLAY_MODE=shuffle` (runtime) and/or
 * `NEXT_PUBLIC_DAILY_PLAY_MODE=shuffle` (must rebuild for client inlining).
 */
export function getDailyPlayMode(): DailyPlayMode {
  const mode = (
    process.env.DAILY_PLAY_MODE?.trim() ||
    process.env.NEXT_PUBLIC_DAILY_PLAY_MODE?.trim() ||
    ""
  ).toLowerCase();
  return mode === "shuffle" ? "shuffle" : "streak";
}

export function isShuffleDailyPlay(): boolean {
  return getDailyPlayMode() === "shuffle";
}

export const DEFAULT_SHUFFLE_CAMPAIGN_ID = Number(
  process.env.SHUFFLE_CAMPAIGN_ID?.trim() ||
    process.env.NEXT_PUBLIC_SHUFFLE_CAMPAIGN_ID?.trim() ||
    "3"
);

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
};
