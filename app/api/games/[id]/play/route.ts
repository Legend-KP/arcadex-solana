import { NextResponse } from "next/server";
import { incrementGamePlayCount } from "@/lib/player-backend";
import {
  isGameVisibleFromFlags,
  resolveGameGating,
} from "@/lib/game-gating";
import {
  checkRateLimit,
  getClientIp,
  rateLimitResponse,
} from "@/lib/rate-limit";
import { recordApiMetric } from "@/lib/api-metrics";

export const dynamic = "force-dynamic";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const started = Date.now();
  const ip = getClientIp(request);

  if (!(await checkRateLimit(`play:ip:${ip}`, 120, 60_000))) {
    recordApiMetric({
      endpoint: "/api/games/[id]/play",
      method: "POST",
      status: 429,
      rateLimited: true,
      durationMs: Date.now() - started,
    });
    return rateLimitResponse();
  }

  try {
    const { id } = await params;
    const flags = await resolveGameGating(id);

    if (!flags || !isGameVisibleFromFlags(flags)) {
      return NextResponse.json({ error: "Game not found." }, { status: 404 });
    }

    const count = await incrementGamePlayCount(id);

    recordApiMetric({
      endpoint: "/api/games/[id]/play",
      method: "POST",
      status: 200,
      gameId: id,
      durationMs: Date.now() - started,
      firestoreReads: 0,
      cacheHit: true,
      cacheLayer: "doc",
    });

    return NextResponse.json({ count });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Failed to record play.";
    recordApiMetric({
      endpoint: "/api/games/[id]/play",
      method: "POST",
      status: 500,
      durationMs: Date.now() - started,
    });
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
