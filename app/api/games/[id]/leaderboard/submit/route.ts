import { isContestActive } from "@/lib/contest";
import {
  gamePickFromGatingFlags,
  resolveGameGating,
} from "@/lib/game-gating";
import {
  activateScoreSubmitOnServer,
  ScoreSubmitActivationError,
} from "@/lib/player-backend";
import {
  corsJsonResponse,
  handleCorsPreflightRequest,
} from "@/lib/cors";
import { recordApiMetric } from "@/lib/api-metrics";
import {
  checkRateLimit,
  getClientIp,
  rateLimitResponse,
} from "@/lib/rate-limit";
import { gameHasLeaderboard } from "@/types";
import { isWalletAddress, normalizeWalletAddress } from "@/lib/wallet-address";
import { requireWalletAuth } from "@/lib/wallet-session";

export const dynamic = "force-dynamic";

export async function OPTIONS(request: Request) {
  return handleCorsPreflightRequest(request);
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const started = Date.now();
  const ip = getClientIp(request);

  if (!(await checkRateLimit(`leaderboard-submit:ip:${ip}`, 60, 60_000))) {
    recordApiMetric({
      endpoint: "/api/games/[id]/leaderboard/submit",
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
    const game = flags ? gamePickFromGatingFlags(id, flags) : null;
    if (!game || !gameHasLeaderboard(game)) {
      return corsJsonResponse(
        request,
        { error: "Leaderboard is not enabled for this game." },
        { status: 404 }
      );
    }

    const body = (await request.json()) as {
      walletAddress?: string;
      txHash?: string;
      score?: number;
    };

    const rawWallet = body.walletAddress?.trim() ?? "";
    const txHash = body.txHash?.trim() ?? "";
    const score = body.score;

    if (!rawWallet || !isWalletAddress(rawWallet)) {
      return corsJsonResponse(
        request,
        { error: "walletAddress is required.", code: "NO_WALLET" },
        { status: 400 }
      );
    }

    if (!txHash) {
      return corsJsonResponse(
        request,
        { error: "txHash is required.", code: "INVALID_TX" },
        { status: 400 }
      );
    }

    if (typeof score !== "number" || !Number.isFinite(score) || score <= 0) {
      return corsJsonResponse(
        request,
        { error: "score is required.", code: "NO_SCORE" },
        { status: 400 }
      );
    }

    const wallet = normalizeWalletAddress(rawWallet);
    const auth = await requireWalletAuth(request, wallet);
    if (!auth.ok) {
      return corsJsonResponse(
        request,
        { error: auth.error, code: "UNAUTHORIZED" },
        { status: auth.status }
      );
    }

    const contestStartedAt =
      isContestActive(game) && typeof game.contestStartedAt === "number"
        ? game.contestStartedAt
        : undefined;
    const result = await activateScoreSubmitOnServer(
      wallet,
      id,
      txHash,
      score,
      { contestStartedAt }
    );

    recordApiMetric({
      endpoint: "/api/games/[id]/leaderboard/submit",
      method: "POST",
      status: 200,
      gameId: id,
      durationMs: Date.now() - started,
      firestoreReads: 0,
    });

    return corsJsonResponse(request, {
      success: true,
      ...result,
    });
  } catch (err) {
    if (err instanceof ScoreSubmitActivationError) {
      const status = err.code === "TX_ALREADY_USED" ? 409 : 400;
      return corsJsonResponse(
        request,
        { error: err.message, code: err.code },
        { status }
      );
    }

    const message =
      err instanceof Error ? err.message : "Failed to submit score.";
    recordApiMetric({
      endpoint: "/api/games/[id]/leaderboard/submit",
      method: "POST",
      status: 500,
      durationMs: Date.now() - started,
    });
    return corsJsonResponse(request, { error: message }, { status: 500 });
  }
}
