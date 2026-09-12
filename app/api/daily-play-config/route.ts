import { NextResponse } from "next/server";
import {
  getDailyCampaignId,
  getDailyPlayMode,
} from "@/lib/daily-play-mode";
import {
  checkRateLimit,
  getClientIp,
  rateLimitResponse,
} from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

/** Runtime daily-play config — works with Cloudflare vars without rebuild. */
export async function GET(request: Request) {
  const ip = getClientIp(request);
  if (!(await checkRateLimit(`daily-play-config:ip:${ip}`, 120, 60_000))) {
    return rateLimitResponse();
  }

  const mode = getDailyPlayMode();
  return NextResponse.json(
    {
      mode,
      campaignId: getDailyCampaignId(),
      shuffle: mode === "shuffle",
    },
    {
      headers: {
        "Cache-Control": "no-store",
      },
    }
  );
}
