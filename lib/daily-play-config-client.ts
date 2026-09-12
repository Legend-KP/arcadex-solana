"use client";

import type { DailyPlayConfig, DailyPlayMode } from "@/lib/daily-play-mode";

let cached: DailyPlayConfig | null = null;
let inflight: Promise<DailyPlayConfig> | null = null;

function fallbackConfig(): DailyPlayConfig {
  const mode = (
    process.env.NEXT_PUBLIC_DAILY_PLAY_MODE?.trim() || ""
  ).toLowerCase() === "shuffle"
    ? "shuffle"
    : "streak";
  const campaignId = Number(
    process.env.NEXT_PUBLIC_SHUFFLE_CAMPAIGN_ID?.trim() || "3"
  );
  return {
    mode: mode as DailyPlayMode,
    campaignId: mode === "shuffle" ? campaignId : 1,
    shuffle: mode === "shuffle",
  };
}

/** Prefer server runtime config (Cloudflare vars) over build-time NEXT_PUBLIC. */
export async function fetchDailyPlayConfig(
  opts?: { fresh?: boolean }
): Promise<DailyPlayConfig> {
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
        campaignId: Number(data.campaignId) || (data.mode === "shuffle" ? 3 : 1),
        shuffle: data.mode === "shuffle",
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
