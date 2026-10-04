"use client";

import type { DailyPlayConfig, DailyPlayMode } from "@/lib/daily-play-mode";

let cached: DailyPlayConfig | null = null;
let inflight: Promise<DailyPlayConfig> | null = null;

function fallbackConfig(): DailyPlayConfig {
  const raw = (
    process.env.NEXT_PUBLIC_DAILY_PLAY_MODE?.trim() || "streak"
  ).toLowerCase();
  const mode: DailyPlayMode = raw === "shuffle" ? "shuffle" : "streak";
  const campaignId = Number(
    process.env.NEXT_PUBLIC_STREAK_CAMPAIGN_ID?.trim() ||
      process.env.NEXT_PUBLIC_SHUFFLE_CAMPAIGN_ID?.trim() ||
      (mode === "shuffle" ? "3" : "1")
  );
  return {
    mode,
    campaignId,
    shuffle: mode === "shuffle",
    streakActive: mode === "streak",
  };
}

/** Prefer server runtime config (Cloudflare vars) over build-time NEXT_PUBLIC. */
export async function fetchDailyPlayConfig(opts?: {
  fresh?: boolean;
}): Promise<DailyPlayConfig> {
  if (!opts?.fresh && cached) return cached;
  if (!opts?.fresh && inflight) return inflight;

  inflight = (async () => {
    try {
      const res = await fetch("/api/daily-play-config", { cache: "no-store" });
      if (!res.ok) throw new Error("config fetch failed");
      const data = (await res.json()) as DailyPlayConfig;
      if (data.mode !== "shuffle" && data.mode !== "streak") {
        throw new Error("invalid mode");
      }
      cached = {
        mode: data.mode,
        campaignId:
          Number(data.campaignId) || (data.mode === "shuffle" ? 3 : 1),
        shuffle: data.mode === "shuffle",
        streakActive: data.mode === "streak",
      };
      return cached;
    } catch {
      return fallbackConfig();
    } finally {
      inflight = null;
    }
  })();

  return inflight;
}
