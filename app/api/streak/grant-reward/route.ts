import { NextResponse } from "next/server";
import { DEFAULT_STREAK_CAMPAIGN_ID, getDailyPlayMode } from "@/lib/daily-play-mode";
import {
  checkRateLimit,
  getClientIp,
  rateLimitResponse,
} from "@/lib/rate-limit";
import { isSolanaAddress } from "@/lib/solana-address";
import { normalizeWalletAddress } from "@/lib/wallet-address";
import {
  getStreakProgress,
  markStreakMilestoneClaimed,
} from "@/lib/daily-play-server";
import { requireD1 } from "@/lib/d1-client";
import { INFINITE_SPARK_DURATION_MS } from "@/lib/infinite-spark";

export const dynamic = "force-dynamic";

/**
 * Grant Infinite Spark for a completed streak milestone (off-chain).
 * Available when streak mode is enabled.
 */
export async function POST(request: Request) {
  const ip = getClientIp(request);
  if (!(await checkRateLimit(`streak-grant:ip:${ip}`, 20, 60_000))) {
    return rateLimitResponse();
  }

  try {
    if (getDailyPlayMode() !== "streak") {
      return NextResponse.json(
        {
          error: "Streak mode is not active.",
          code: "STREAK_INACTIVE",
        },
        { status: 503 }
      );
    }

    const body = (await request.json()) as {
      walletAddress?: string;
      campaignId?: number;
    };
    const rawWallet = body.walletAddress?.trim() ?? "";
    const campaignId =
      typeof body.campaignId === "number" && Number.isFinite(body.campaignId)
        ? body.campaignId
        : DEFAULT_STREAK_CAMPAIGN_ID;

    if (!rawWallet || !isSolanaAddress(rawWallet)) {
      return NextResponse.json(
        { error: "A valid Solana wallet is required.", code: "NO_WALLET" },
        { status: 400 }
      );
    }
    const wallet = normalizeWalletAddress(rawWallet);
    const progress = await getStreakProgress(wallet, campaignId);

    if (progress.milestoneClaimed) {
      return NextResponse.json({ ok: true, granted: false, alreadyGranted: true });
    }

    // Allow grant if they just hit required days this cycle (currentDay was reset
    // to 0 after milestone in applyStreakCheckIn) — client should call immediately.
    const db = await requireD1();
    const now = Date.now();
    await db
      .prepare(
        `INSERT INTO users (wallet, name, created_at, updated_at)
         VALUES (?, '', ?, ?)
         ON CONFLICT(wallet) DO UPDATE SET updated_at = excluded.updated_at`
      )
      .bind(wallet, now, now)
      .run();
    const row = await db
      .prepare(`SELECT infinite_until, max, regen_ms, slots_json FROM sparks WHERE wallet = ?`)
      .bind(wallet)
      .first<{
        infinite_until: number | null;
        max: number;
        regen_ms: number;
        slots_json: string;
      }>();
    const base =
      row?.infinite_until && row.infinite_until > now
        ? row.infinite_until
        : now;
    const nextUntil = base + INFINITE_SPARK_DURATION_MS;

    await db
      .prepare(
        `INSERT INTO sparks (wallet, max, regen_ms, slots_json, infinite_until)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(wallet) DO UPDATE SET infinite_until = excluded.infinite_until`
      )
      .bind(
        wallet,
        row?.max ?? 4,
        row?.regen_ms ?? 3 * 60 * 60 * 1000,
        row?.slots_json ?? "[]",
        nextUntil
      )
      .run();

    await markStreakMilestoneClaimed(wallet, campaignId);

    return NextResponse.json({ ok: true, granted: true, infiniteUntil: nextUntil });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Could not grant streak reward.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
