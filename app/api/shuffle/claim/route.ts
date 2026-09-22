import { NextResponse } from "next/server";
import { DEFAULT_SHUFFLE_CAMPAIGN_ID } from "@/lib/daily-play-mode";
import {
  checkRateLimit,
  getClientIp,
  rateLimitResponse,
} from "@/lib/rate-limit";
import { isSolanaAddress } from "@/lib/solana-address";
import { normalizeWalletAddress } from "@/lib/wallet-address";
import { createWalletSessionToken, isWalletAuthEnabled } from "@/lib/wallet-session";
import {
  confirmShuffleUsdtBudget,
  consumeShufflePending,
  getShufflePending,
  hasCompletedShuffleToday,
  markShuffleCompletedToday,
  shuffleUsdtReservationKey,
} from "@/lib/daily-play-server";
import { sendPrizeUsdt, isPrizeWalletConfigured } from "@/lib/solana-prize-payout";
import { requireD1 } from "@/lib/d1-client";
import { INFINITE_SPARK_DURATION_MS } from "@/lib/infinite-spark";

export const dynamic = "force-dynamic";

async function grantInfiniteSparkOnServer(wallet: string): Promise<boolean> {
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
  return true;
}

export async function POST(request: Request) {
  const ip = getClientIp(request);
  if (!(await checkRateLimit(`shuffle-claim:ip:${ip}`, 30, 60_000))) {
    return rateLimitResponse();
  }

  try {
    const body = (await request.json()) as {
      walletAddress?: string;
      campaignId?: number;
      nonce?: string;
    };

    const rawWallet = body.walletAddress?.trim() ?? "";
    const nonce = body.nonce?.trim() ?? "";
    const campaignId =
      typeof body.campaignId === "number" && Number.isFinite(body.campaignId)
        ? body.campaignId
        : DEFAULT_SHUFFLE_CAMPAIGN_ID;

    if (!rawWallet || !isSolanaAddress(rawWallet)) {
      return NextResponse.json(
        { error: "A valid Solana wallet is required.", code: "NO_WALLET" },
        { status: 400 }
      );
    }
    if (!nonce) {
      return NextResponse.json(
        { error: "nonce is required.", code: "INVALID_NONCE" },
        { status: 400 }
      );
    }

    const wallet = normalizeWalletAddress(rawWallet);
    if (!(await checkRateLimit(`shuffle-claim:wallet:${wallet}`, 12, 60_000))) {
      return rateLimitResponse();
    }

    const pending = await getShufflePending(wallet, campaignId, nonce);
    if (!pending) {
      return NextResponse.json(
        { error: "Shuffle session not found. Tap Shuffle again.", code: "NO_PENDING" },
        { status: 404 }
      );
    }

    if (pending.consumedAt) {
      return NextResponse.json({
        ok: true,
        alreadyClaimed: true,
        walletAddress: wallet,
        campaignId,
        nonce,
        outcome: pending.payload.outcome,
        needsClaim: false,
        infiniteSparkGranted: pending.payload.outcome.type === "spark",
        payoutSignature: pending.txHash,
        token: isWalletAuthEnabled()
          ? await createWalletSessionToken(wallet)
          : null,
      });
    }

    if (await hasCompletedShuffleToday(wallet, campaignId)) {
      return NextResponse.json(
        {
          error: "Already shuffled today. Come back after the daily interval.",
          code: "TOO_SOON",
        },
        { status: 409 }
      );
    }

    const outcome = pending.payload.outcome;
    let payoutSignature: string | null = null;
    let infiniteSparkGranted = false;

    if (outcome.type === "usdt") {
      if (!isPrizeWalletConfigured()) {
        return NextResponse.json(
          {
            error: "Prize wallet is not configured yet.",
            code: "NO_PRIZE_WALLET",
          },
          { status: 503 }
        );
      }
      if (outcome.amount == null || outcome.amount <= 0) {
        return NextResponse.json(
          { error: "Invalid USDT prize amount.", code: "INVALID_AMOUNT" },
          { status: 400 }
        );
      }
      const paid = await sendPrizeUsdt({
        toWallet: wallet,
        amount: outcome.amount,
      });
      payoutSignature = paid.signature;
      await confirmShuffleUsdtBudget({
        dayKey: pending.payload.dayKey,
        reservationKey: shuffleUsdtReservationKey(wallet, campaignId, nonce),
        txHash: payoutSignature,
      });
    } else if (outcome.type === "spark") {
      infiniteSparkGranted = await grantInfiniteSparkOnServer(wallet);
    }

    const consumed = await consumeShufflePending({
      wallet,
      campaignId,
      nonce,
      txHash: payoutSignature,
    });
    if (!consumed) {
      return NextResponse.json(
        { error: "Shuffle already claimed.", code: "ALREADY_CLAIMED" },
        { status: 409 }
      );
    }

    await markShuffleCompletedToday({
      wallet,
      campaignId,
      dayKey: pending.payload.dayKey,
      outcomeId: outcome.id,
      payoutSignature,
    });

    return NextResponse.json({
      ok: true,
      walletAddress: wallet,
      campaignId,
      nonce,
      outcome,
      needsClaim: false,
      infiniteSparkGranted,
      payoutSignature,
      token: isWalletAuthEnabled()
        ? await createWalletSessionToken(wallet)
        : null,
    });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Could not claim shuffle reward.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
