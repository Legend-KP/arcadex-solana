import { NextResponse } from "next/server";
import { recordApiMetric } from "@/lib/api-metrics";
import { loadCatalogListForRequest } from "@/lib/catalog-request";
import { GAMES_API_CACHE_CONTROL } from "@/lib/game-cache";
import {
  checkRateLimit,
  getClientIp,
  rateLimitResponse,
} from "@/lib/rate-limit";
import { fetchHomePlayerFromServer } from "@/lib/player-backend";
import { computeSparkSnapshot } from "@/lib/spark";
import {
  isWalletAddress,
  normalizeWalletAddress,
} from "@/lib/wallet-address";
import { requireWalletAuth } from "@/lib/wallet-session";

export const dynamic = "force-dynamic";

const HOME_IP_LIMIT = 120;
const HOME_WINDOW_MS = 60_000;

export async function GET(request: Request) {
  const started = Date.now();
  const ip = getClientIp(request);

  if (!(await checkRateLimit(`home:ip:${ip}`, HOME_IP_LIMIT, HOME_WINDOW_MS))) {
    recordApiMetric({
      endpoint: "/api/home",
      method: "GET",
      status: 429,
      rateLimited: true,
      durationMs: Date.now() - started,
    });
    return rateLimitResponse();
  }

  try {
    const { searchParams } = new URL(request.url);
    const walletRaw = searchParams.get("walletAddress")?.trim() ?? "";
    const wallet =
      walletRaw && isWalletAddress(walletRaw)
        ? normalizeWalletAddress(walletRaw)
        : "";

    const catalogPromise = loadCatalogListForRequest(request);
    const playerPromise = wallet
      ? (async () => {
          const auth = await requireWalletAuth(request, wallet);
          if (!auth.ok) {
            return { user: null, state: null, sparks: null };
          }
          try {
            const homePlayer = await fetchHomePlayerFromServer(wallet);
            return {
              user: homePlayer.user,
              state: homePlayer.state,
              sparks: computeSparkSnapshot(homePlayer.state),
            };
          } catch {
            return { user: null, state: null, sparks: null };
          }
        })()
      : Promise.resolve({ user: null, state: null, sparks: null });

    const [catalog, player] = await Promise.all([
      catalogPromise,
      playerPromise,
    ]);
    const { user, state, sparks } = player;

    recordApiMetric({
      endpoint: "/api/home",
      method: "GET",
      status: 200,
      durationMs: Date.now() - started,
      firestoreReads: catalog.firestoreReads,
      cacheHit: catalog.cacheHit,
      cacheLayer: "list",
    });

    return NextResponse.json(
      {
        games: catalog.games,
        playCounts: catalog.playCounts,
        user,
        state,
        sparks,
      },
      {
        headers: {
          "Cache-Control": GAMES_API_CACHE_CONTROL,
          "CDN-Cache-Control": "no-store",
          Vary: "Cookie, Authorization",
        },
      }
    );
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Failed to load home.";
    recordApiMetric({
      endpoint: "/api/home",
      method: "GET",
      status: 500,
      durationMs: Date.now() - started,
    });
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
