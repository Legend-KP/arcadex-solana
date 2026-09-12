import { fetchGameFromServer } from "@/lib/firestore-server";
import { buildContestInfo } from "@/lib/contest";
import {
  gamePickFromGatingFlags,
  resolveGameGating,
} from "@/lib/game-gating";
import {
  fetchContestLeaderboardFromServer,
  fetchLeaderboardFromServer,
  fetchPersonalBestFromServer,
  fetchUserSubmittedScoreFromServer,
  fetchUserFromServer,
  saveGameProgressOnServer,
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
import { gameHasContest, gameHasLeaderboard, LEADERBOARD_MAX_ENTRIES, LeaderboardEntry } from "@/types";
import { isWalletAddress, tryNormalizeWalletAddress } from "@/lib/wallet-address";
import { requireWalletAuth } from "@/lib/wallet-session";

export const dynamic = "force-dynamic";

export async function OPTIONS(request: Request) {
  return handleCorsPreflightRequest(request);
}

async function assertLeaderboardEnabled(
  request: Request,
  gameId: string
) {
  const flags = await resolveGameGating(gameId);
  if (!flags || !gameHasLeaderboard(gamePickFromGatingFlags(gameId, flags))) {
    return {
      response: corsJsonResponse(
        request,
        { error: "Leaderboard is not enabled for this game." },
        { status: 404 }
      ),
      game: null,
    };
  }
  return {
    response: null,
    game: gamePickFromGatingFlags(gameId, flags),
  };
}

function parseScoreBody(body: LeaderboardEntry & { value?: number }) {
  const score =
    typeof body.score === "number"
      ? body.score
      : typeof body.value === "number"
        ? body.value
        : undefined;
  return score;
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const started = Date.now();
  const ip = getClientIp(request);

  if (!(await checkRateLimit(`leaderboard:ip:${ip}`, 90, 60_000))) {
    recordApiMetric({
      endpoint: "/api/games/[id]/leaderboard",
      method: "GET",
      status: 429,
      rateLimited: true,
      durationMs: Date.now() - started,
    });
    return rateLimitResponse();
  }

  try {
    const { id } = await params;
    const { response: disabled, game } = await assertLeaderboardEnabled(request, id);
    if (disabled || !game) return disabled;

    const { searchParams } = new URL(request.url);
    const wallet = searchParams.get("wallet") ?? undefined;
    const name = searchParams.get("name") ?? undefined;

    const entries = await fetchLeaderboardFromServer(id, LEADERBOARD_MAX_ENTRIES);
    const personalBest =
      wallet
        ? await fetchPersonalBestFromServer(wallet, id)
        : undefined;
    const submittedBest =
      wallet || name
        ? await fetchUserSubmittedScoreFromServer(id, {
            walletAddress: wallet,
            playerName: name,
          })
        : undefined;

    let contest = null;
    if (gameHasContest(game) && typeof game.contestStartedAt === "number") {
      const contestEntries = await fetchContestLeaderboardFromServer(
        id,
        game.contestStartedAt
      );
      contest = buildContestInfo(game, contestEntries);
    }

    return corsJsonResponse(request, {
      entries,
      personalBest,
      submittedBest,
      canSubmit:
        typeof personalBest === "number" &&
        typeof submittedBest === "number" &&
        personalBest > submittedBest,
      contest,
    });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Failed to load leaderboard.";
    recordApiMetric({
      endpoint: "/api/games/[id]/leaderboard",
      method: "GET",
      status: 500,
      durationMs: Date.now() - started,
    });
    return corsJsonResponse(request, { error: message }, { status: 500 });
  }
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const ip = getClientIp(request);
  if (!(await checkRateLimit(`leaderboard-post:ip:${ip}`, 60, 60_000))) {
    return rateLimitResponse();
  }

  try {
    const { id } = await params;
    const { response: disabled } = await assertLeaderboardEnabled(request, id);
    if (disabled) return disabled;

    const body = (await request.json()) as LeaderboardEntry & {
      value?: number;
      playerName?: string;
    };
    const score = parseScoreBody(body);

    if (typeof score !== "number") {
      return corsJsonResponse(
        request,
        { error: "score is required." },
        { status: 400 }
      );
    }

    const wallet = tryNormalizeWalletAddress(body.walletAddress);
    let name = body.name?.trim() || body.playerName?.trim() || "";

    if (!wallet || !isWalletAddress(wallet)) {
      return corsJsonResponse(
        request,
        { error: "A wallet address is required to save scores." },
        { status: 400 }
      );
    }

    if (!(await checkRateLimit(`leaderboard-post:wallet:${wallet}`, 40, 60_000))) {
      return rateLimitResponse();
    }

    const auth = await requireWalletAuth(request, wallet);
    if (!auth.ok) {
      return corsJsonResponse(
        request,
        { error: auth.error },
        { status: auth.status }
      );
    }

    if (!name) {
      const profile = await fetchUserFromServer(wallet);
      name = profile?.name?.trim() || "";
    }

    if (!name) {
      name = `${wallet.slice(0, 6)}...${wallet.slice(-4)}`;
    }

    await saveGameProgressOnServer(wallet, id, score, true, {
      playerName: name,
    });

    const personalBest = await fetchPersonalBestFromServer(wallet, id);
    const submittedBest = await fetchUserSubmittedScoreFromServer(id, {
      walletAddress: wallet,
      playerName: name,
    });

    return corsJsonResponse(request, {
      success: true,
      personalBest,
      submittedBest,
      canSubmit: personalBest > submittedBest,
    });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Failed to submit score.";
    return corsJsonResponse(request, { error: message }, { status: 500 });
  }
}
