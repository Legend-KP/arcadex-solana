import { NextResponse } from "next/server";
import {
  apiErrorResponse,
  unauthorizedResponse,
  verifyAdminRequest,
} from "@/lib/admin-auth";
import { recordApiMetric } from "@/lib/api-metrics";
import { loadCatalogListForRequest } from "@/lib/catalog-request";
import { GAMES_API_CACHE_CONTROL } from "@/lib/game-cache";
import { createGameOnServer } from "@/lib/firestore-server";
import { normalizeImageAssetUrl } from "@/lib/game-assets";
import {
  checkRateLimit,
  getClientIp,
  rateLimitResponse,
} from "@/lib/rate-limit";
import { Game } from "@/types";

export const dynamic = "force-dynamic";

const GAMES_LIST_IP_LIMIT = 120;
const GAMES_LIST_WINDOW_MS = 60_000;

export async function GET(request: Request) {
  const started = Date.now();
  const ip = getClientIp(request);

  if (!(await checkRateLimit(`games-list:ip:${ip}`, GAMES_LIST_IP_LIMIT, GAMES_LIST_WINDOW_MS))) {
    recordApiMetric({
      endpoint: "/api/games",
      method: "GET",
      status: 429,
      rateLimited: true,
      durationMs: Date.now() - started,
    });
    return rateLimitResponse();
  }

  try {
    const catalog = await loadCatalogListForRequest(request);

    recordApiMetric({
      endpoint: "/api/games",
      method: "GET",
      status: 200,
      durationMs: Date.now() - started,
      firestoreReads: catalog.firestoreReads,
      cacheHit: catalog.cacheHit,
      cacheLayer: "list",
    });

    return NextResponse.json(
      { games: catalog.games, playCounts: catalog.playCounts },
      {
        headers: {
          "Cache-Control": GAMES_API_CACHE_CONTROL,
          "CDN-Cache-Control": "no-store",
          Vary: "Cookie",
        },
      }
    );
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Failed to load games.";
    const hint = message.includes("Cloud Firestore API")
      ? " Enable the Cloud Firestore API in Google Cloud Console, then redeploy."
      : "";
    recordApiMetric({
      endpoint: "/api/games",
      method: "GET",
      status: 500,
      durationMs: Date.now() - started,
    });
    return NextResponse.json(
      { error: `${message}${hint}` },
      { status: 500 }
    );
  }
}

export async function POST(request: Request) {
  if (!(await verifyAdminRequest(request))) return unauthorizedResponse();

  try {
    const body = (await request.json()) as Omit<Game, "id" | "createdAt">;

    if (!body.name?.trim() || !body.url?.trim()) {
      return NextResponse.json(
        { error: "Name and URL are required." },
        { status: 400 }
      );
    }

    const id = await createGameOnServer({
      name: body.name.trim(),
      thumbnail: body.thumbnail?.trim() ?? "",
      url: body.url.trim(),
      plays: body.plays?.trim() || "0",
      fallbackImage: normalizeImageAssetUrl(body.fallbackImage),
      active: body.active ?? true,
      live: body.live !== false,
      hasLeaderboard: body.hasLeaderboard !== false,
      contestLive: body.contestLive === true,
    });

    return NextResponse.json({ id }, { status: 201 });
  } catch (err) {
    return apiErrorResponse(err, "Failed to add game.");
  }
}
