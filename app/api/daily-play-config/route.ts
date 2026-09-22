import { NextResponse } from "next/server";
import {
  getDailyCampaignId,
  getDailyPlayMode,
  type DailyPlayConfig,
} from "@/lib/daily-play-mode";

export const dynamic = "force-dynamic";

export async function GET() {
  const mode = getDailyPlayMode();
  const body: DailyPlayConfig = {
    mode,
    campaignId: getDailyCampaignId(),
    shuffle: mode === "shuffle",
    streakActive: mode === "streak",
  };
  return NextResponse.json(body, {
    headers: { "cache-control": "no-store" },
  });
}
