import { verifyAdminRequest } from "@/lib/admin-auth";
import { fetchGamesFromServer, isGameVisible } from "@/lib/firestore-server";
import { withFirestoreReadCounter } from "@/lib/firestore-read-counter";
import { fetchAllGamePlayCounts } from "@/lib/player-backend";
import { Game } from "@/types";

export type CatalogListPayload = {
  games: Game[];
  playCounts: Record<string, number>;
  firestoreReads: number;
  cacheHit: boolean;
};

export async function loadCatalogListForRequest(
  request: Request
): Promise<CatalogListPayload> {
  const [{ result: games, firestoreReads }, allCounts] = await Promise.all([
    withFirestoreReadCounter(() => fetchGamesFromServer()),
    fetchAllGamePlayCounts().catch(() => ({}) as Record<string, number>),
  ]);

  const isAdmin = await verifyAdminRequest(request);
  const visible = isAdmin ? games : games.filter(isGameVisible);
  const playCounts = Object.fromEntries(
    visible.map((g) => [
      g.id,
      typeof allCounts[g.id] === "number" ? allCounts[g.id] : 0,
    ])
  );

  return {
    games: visible,
    playCounts,
    firestoreReads,
    cacheHit: firestoreReads === 0,
  };
}
