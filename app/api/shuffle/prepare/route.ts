import { NextResponse } from "next/server";
import { randomBytes } from "crypto";
import { DEFAULT_SHUFFLE_CAMPAIGN_ID } from "@/lib/daily-play-mode";
import {
  checkRateLimit,
  getClientIp,
  rateLimitResponse,
} from "@/lib/rate-limit";
import { isSolanaAddress } from "@/lib/solana-address";
import { normalizeWalletAddress } from "@/lib/wallet-address";
import {
  getShuffleTheaterCards,
  pickShuffleOutcome,
  usdtToMicro,
} from "@/lib/shuffle-outcomes";
import {
  getShuffleUsdtBudgetRemainingUsdt,
  hasCompletedShuffleToday,
  outcomePayloadFromDef,
  reserveShuffleUsdtBudget,
  saveShufflePending,
  shuffleUsdtReservationKey,
  utcDayKey,
} from "@/lib/daily-play-server";
import { isPrizeWalletConfigured } from "@/lib/solana-prize-payout";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const ip = getClientIp(request);
  if (!(await checkRateLimit(`shuffle-prepare:ip:${ip}`, 30, 60_000))) {
    return rateLimitResponse();
  }

  try {
    const body = (await request.json()) as {
      walletAddress?: string;
      campaignId?: number;
    };
    const rawWallet = body.walletAddress?.trim() ?? "";
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
    const wallet = normalizeWalletAddress(rawWallet);

    if (
      !(await checkRateLimit(`shuffle-prepare:wallet:${wallet}`, 12, 60_000))
    ) {
      return rateLimitResponse();
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

    const dayKey = utcDayKey();
    const remainingUsdt = await getShuffleUsdtBudgetRemainingUsdt(dayKey);
    let outcome = pickShuffleOutcome({ remainingUsdt });

    // If USDT won but prize wallet isn't funded/configured, downgrade to none.
    if (outcome.type === "usdt" && !isPrizeWalletConfigured()) {
      outcome = pickShuffleOutcome({ remainingUsdt: 0 });
    }

    const reservedMicro =
      outcome.type === "usdt" && outcome.amount != null
        ? usdtToMicro(outcome.amount)
        : 0;

    const nonce = randomBytes(16).toString("hex");
    if (reservedMicro > 0) {
      const ok = await reserveShuffleUsdtBudget({
        dayKey,
        micro: reservedMicro,
        reservationKey: shuffleUsdtReservationKey(wallet, campaignId, nonce),
      });
      if (!ok) {
        outcome = pickShuffleOutcome({ remainingUsdt: 0 });
      }
    }

    const finalReserved =
      outcome.type === "usdt" && outcome.amount != null
        ? usdtToMicro(outcome.amount)
        : 0;

    const payload = outcomePayloadFromDef(outcome, dayKey, finalReserved);
    await saveShufflePending({
      wallet,
      campaignId,
      nonce,
      payload,
    });

    return NextResponse.json({
      ok: true,
      campaignId,
      nonce,
      outcome: payload.outcome,
      theater: getShuffleTheaterCards(),
      needsClaim: outcome.type === "usdt" || outcome.type === "spark",
    });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Could not prepare shuffle.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
