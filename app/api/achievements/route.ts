import { NextResponse } from "next/server";
import {
  claimMission,
  listAchievementProgress,
} from "@/lib/d1-achievements";
import { recordApiMetric } from "@/lib/api-metrics";
import {
  checkRateLimit,
  getClientIp,
  rateLimitResponse,
} from "@/lib/rate-limit";
import { requireWalletAuth } from "@/lib/wallet-session";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const started = Date.now();
  const ip = getClientIp(request);
  if (!(await checkRateLimit(`achievements:ip:${ip}`, 60, 60_000))) {
    return rateLimitResponse();
  }

  const auth = await requireWalletAuth(request);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  try {
    const payload = await listAchievementProgress(auth.wallet);
    recordApiMetric({
      endpoint: "/api/achievements",
      method: "GET",
      status: 200,
      wallet: auth.wallet,
      durationMs: Date.now() - started,
    });
    return NextResponse.json(payload);
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Could not load achievements.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const started = Date.now();
  const ip = getClientIp(request);
  if (!(await checkRateLimit(`achievements-claim:ip:${ip}`, 30, 60_000))) {
    return rateLimitResponse();
  }

  const auth = await requireWalletAuth(request);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  if (!(await checkRateLimit(`achievements-claim:${auth.wallet}`, 20, 60_000))) {
    return rateLimitResponse();
  }

  try {
    const body = (await request.json()) as { missionId?: string };
    const missionId = body.missionId?.trim() ?? "";
    if (!missionId) {
      return NextResponse.json({ error: "Mission id is required." }, { status: 400 });
    }

    const result = await claimMission(auth.wallet, missionId);
    recordApiMetric({
      endpoint: "/api/achievements",
      method: "POST",
      status: 200,
      wallet: auth.wallet,
      durationMs: Date.now() - started,
    });
    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Could not claim XP.";
    const status = message === "Already claimed." ? 409 : message.includes("not complete") || message.includes("not found") || message.includes("signed in") ? 400 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
