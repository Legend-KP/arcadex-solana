import {
  isGameVisibleFromFlags,
  resolveGameGating,
} from "@/lib/game-gating";
import {
  fetchGameStateFromServer,
  GameStateConflictError,
  saveGameStateOnServer,
} from "@/lib/player-backend";
import {
  corsJsonResponse,
  handleCorsPreflightRequest,
} from "@/lib/cors";
import { recordApiMetric } from "@/lib/api-metrics";
import {
  checkRateLimit,
  getClientIp,
} from "@/lib/rate-limit";
import { isWalletAddress, normalizeWalletAddress } from "@/lib/wallet-address";
import { requireWalletAuth } from "@/lib/wallet-session";

export const dynamic = "force-dynamic";

const STATE_IP_LIMIT = 60;
const STATE_WALLET_LIMIT = 30;
const STATE_WINDOW_MS = 60_000;

export async function OPTIONS(request: Request) {
  return handleCorsPreflightRequest(request);
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const started = Date.now();

  try {
    const { id } = await params;
    const { searchParams } = new URL(request.url);
    const walletRaw = searchParams.get("wallet") ?? "";

    if (!isWalletAddress(walletRaw)) {
      return corsJsonResponse(
        request,
        { error: "A valid wallet query parameter is required." },
        { status: 400 }
      );
    }

    const wallet = normalizeWalletAddress(walletRaw);
    const ip = getClientIp(request);

    const auth = await requireWalletAuth(request, wallet);
    if (!auth.ok) {
      recordApiMetric({
        endpoint: "/api/games/[id]/state",
        method: "GET",
        status: auth.status,
        gameId: id,
        wallet,
        durationMs: Date.now() - started,
      });
      return corsJsonResponse(
        request,
        { error: auth.error },
        { status: auth.status }
      );
    }

    const ipAllowed = await checkRateLimit(
      `state:ip:${ip}`,
      STATE_IP_LIMIT,
      STATE_WINDOW_MS
    );
    const walletAllowed = await checkRateLimit(
      `state:wallet:${wallet}:${id}`,
      STATE_WALLET_LIMIT,
      STATE_WINDOW_MS
    );

    if (!ipAllowed || !walletAllowed) {
      recordApiMetric({
        endpoint: "/api/games/[id]/state",
        method: "GET",
        status: 429,
        gameId: id,
        wallet,
        rateLimited: true,
        durationMs: Date.now() - started,
      });
      return corsJsonResponse(
        request,
        { error: "Too many state requests. Please slow down." },
        { status: 429 }
      );
    }

    const flags = await resolveGameGating(id);
    if (!flags || !isGameVisibleFromFlags(flags)) {
      return corsJsonResponse(
        request,
        { error: "Game not found." },
        { status: 404 }
      );
    }

    const record = await fetchGameStateFromServer(wallet, id);
    recordApiMetric({
      endpoint: "/api/games/[id]/state",
      method: "GET",
      status: 200,
      gameId: id,
      wallet,
      durationMs: Date.now() - started,
      firestoreReads: 0,
      cacheHit: true,
    });

    return corsJsonResponse(request, {
      success: true,
      found: record.found,
      revision: record.revision,
      state: record.state,
    });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Failed to load game state.";
    recordApiMetric({
      endpoint: "/api/games/[id]/state",
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
  const started = Date.now();

  try {
    const { id } = await params;
    const flags = await resolveGameGating(id);
    if (!flags || !isGameVisibleFromFlags(flags)) {
      return corsJsonResponse(
        request,
        { error: "Game not found." },
        { status: 404 }
      );
    }

    const body = (await request.json()) as {
      walletAddress?: string;
      state?: unknown;
      baseRevision?: number;
      requestId?: string;
      merge?: boolean;
    };

    if (!body.walletAddress || !isWalletAddress(body.walletAddress)) {
      return corsJsonResponse(
        request,
        { error: "walletAddress is required." },
        { status: 400 }
      );
    }

    const auth = await requireWalletAuth(request, body.walletAddress);
    if (!auth.ok) {
      return corsJsonResponse(
        request,
        { error: auth.error },
        { status: auth.status }
      );
    }

    if (!body.state || typeof body.state !== "object" || Array.isArray(body.state)) {
      return corsJsonResponse(
        request,
        { error: "state object is required." },
        { status: 400 }
      );
    }

    const record = await saveGameStateOnServer(body.walletAddress, id, body.state, {
      baseRevision: body.baseRevision,
      merge: body.merge === true,
    });

    recordApiMetric({
      endpoint: "/api/games/[id]/state",
      method: "POST",
      status: 200,
      gameId: id,
      durationMs: Date.now() - started,
      firestoreReads: 0,
    });

    return corsJsonResponse(request, {
      success: true,
      conflict: false,
      found: record.found,
      revision: record.revision,
      requestId: body.requestId ?? "",
      state: record.state,
    });
  } catch (err) {
    if (err instanceof GameStateConflictError) {
      recordApiMetric({
        endpoint: "/api/games/[id]/state",
        method: "POST",
        status: 409,
        durationMs: Date.now() - started,
      });
      return corsJsonResponse(
        request,
        {
          success: false,
          conflict: true,
          revision: err.revision,
          state: err.state,
          error: err.message,
        },
        { status: 409 }
      );
    }

    const message =
      err instanceof Error ? err.message : "Failed to save game state.";
    recordApiMetric({
      endpoint: "/api/games/[id]/state",
      method: "POST",
      status: 500,
      durationMs: Date.now() - started,
    });
    return corsJsonResponse(request, { error: message }, { status: 500 });
  }
}
