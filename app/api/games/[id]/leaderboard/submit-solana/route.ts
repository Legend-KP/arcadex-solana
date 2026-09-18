import { NextResponse } from "next/server";
import { requireD1 } from "@/lib/d1-client";
import {
  corsJsonResponse,
  handleCorsPreflightRequest,
} from "@/lib/cors";
import {
  gamePickFromGatingFlags,
  resolveGameGating,
} from "@/lib/game-gating";
import {
  checkRateLimit,
  getClientIp,
  rateLimitResponse,
} from "@/lib/rate-limit";
import { isSolanaAddress } from "@/lib/solana-address";
import { gameHasLeaderboard } from "@/types";

export const dynamic = "force-dynamic";

export async function OPTIONS(request: Request) {
  return handleCorsPreflightRequest(request);
}

/**
 * After `/api/solana/payments/confirm` for score_submit, post the score.
 * Payment guard must already exist for this signature.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const ip = getClientIp(request);
  if (!(await checkRateLimit(`lb-submit-sol:ip:${ip}`, 40, 60_000))) {
    return rateLimitResponse();
  }

  try {
    const { id: gameId } = await params;
    const flags = await resolveGameGating(gameId);
    const game = flags ? gamePickFromGatingFlags(gameId, flags) : null;
    if (!game || !gameHasLeaderboard(game)) {
      return corsJsonResponse(
        request,
        { error: "Leaderboard is not enabled for this game." },
        { status: 404 }
      );
    }

    const body = (await request.json()) as {
      walletAddress?: string;
      signature?: string;
      score?: number;
      playerName?: string;
    };

    const wallet = body.walletAddress?.trim() ?? "";
    const signature = body.signature?.trim() ?? "";
    const score = body.score;
    const playerName = body.playerName?.trim() ?? "";

    if (!isSolanaAddress(wallet)) {
      return corsJsonResponse(
        request,
        { error: "A valid Solana wallet is required.", code: "NO_WALLET" },
        { status: 400 }
      );
    }
    if (!signature) {
      return corsJsonResponse(
        request,
        { error: "signature is required.", code: "INVALID_TX" },
        { status: 400 }
      );
    }
    if (typeof score !== "number" || !Number.isFinite(score) || score <= 0) {
      return corsJsonResponse(
        request,
        { error: "A valid score is required.", code: "NO_SCORE" },
        { status: 400 }
      );
    }
    if (!playerName) {
      return corsJsonResponse(
        request,
        { error: "Set your player name before submitting.", code: "NO_NAME" },
        { status: 400 }
      );
    }

    const db = await requireD1();
    const pk = `solana:score_submit:${signature}`;
    const guard = await db
      .prepare(`SELECT wallet FROM payment_guards WHERE tx_hash = ?`)
      .bind(pk)
      .first<{ wallet: string }>();

    if (!guard?.wallet) {
      return corsJsonResponse(
        request,
        {
          error: "Payment not confirmed yet. Wait and retry.",
          code: "INVALID_TX",
        },
        { status: 400 }
      );
    }
    if (guard.wallet !== wallet) {
      return corsJsonResponse(
        request,
        {
          error: "This payment was already used by another wallet.",
          code: "TX_ALREADY_USED",
        },
        { status: 409 }
      );
    }

    const playerKey = `sol_${wallet}`;
    const now = Date.now();
    const existing = await db
      .prepare(
        `SELECT score FROM leaderboard_entries WHERE game_id = ? AND player_key = ?`
      )
      .bind(gameId, playerKey)
      .first<{ score: number }>();

    if (
      !(
        existing &&
        typeof existing.score === "number" &&
        existing.score >= score
      )
    ) {
      await db
        .prepare(
          `INSERT INTO leaderboard_entries (game_id, player_key, name, score, wallet, created_at)
           VALUES (?, ?, ?, ?, ?, ?)
           ON CONFLICT(game_id, player_key) DO UPDATE SET
             name = excluded.name,
             score = excluded.score,
             wallet = excluded.wallet,
             created_at = excluded.created_at
           WHERE excluded.score > leaderboard_entries.score`
        )
        .bind(gameId, playerKey, playerName, score, wallet, now)
        .run();
    }

    const best = await db
      .prepare(
        `SELECT score FROM leaderboard_entries WHERE game_id = ? AND player_key = ?`
      )
      .bind(gameId, playerKey)
      .first<{ score: number }>();

    const leaderboardScore = best?.score ?? score;
    return corsJsonResponse(request, {
      highScore: leaderboardScore,
      leaderboardScore,
      submitted: true,
    });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Could not submit Solana score.";
    return corsJsonResponse(request, { error: message }, { status: 500 });
  }
}
