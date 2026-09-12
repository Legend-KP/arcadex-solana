import { invalidateGameFlagsCache } from "@/lib/rtdb-cache";
import {
  fetchGameGatingFlagsFromRtdb,
  listGameGatingFlagIds,
  syncGameGatingFlagsToRtdb,
  deleteGameGatingFlagsFromRtdb,
} from "@/lib/player-backend";
import { fetchGamesFromServer } from "@/lib/firestore-server";
import { Game, GameGatingFlags } from "@/types";

export type GatingMismatch = {
  gameId: string;
  issue: "missing_rtdb" | "orphan_rtdb" | "mismatch";
  firestore?: Partial<GameGatingFlags> | null;
  rtdb?: GameGatingFlags | null;
  fields?: string[];
};

export type ReconcileGameFlagsReport = {
  firestoreCount: number;
  rtdbFlagCount: number;
  missing: GatingMismatch[];
  orphans: GatingMismatch[];
  mismatches: GatingMismatch[];
  repaired: string[];
};

function flagsFromGame(game: Game): GameGatingFlags {
  return {
    active: game.active !== false,
    live: game.live !== false,
    hasLeaderboard: game.hasLeaderboard !== false,
    contestLive: game.contestLive === true,
    contestDurationDays: game.contestDurationDays,
    contestTask: game.contestTask,
    contestStartedAt: game.contestStartedAt,
    contestEndsAt: game.contestEndsAt,
  };
}

function compareFlags(
  gameId: string,
  expected: GameGatingFlags,
  actual: GameGatingFlags
): GatingMismatch | null {
  const fields: string[] = [];
  const keys: (keyof GameGatingFlags)[] = [
    "active",
    "live",
    "hasLeaderboard",
    "contestLive",
    "contestDurationDays",
    "contestTask",
    "contestStartedAt",
    "contestEndsAt",
  ];

  for (const key of keys) {
    const a = expected[key];
    const b = actual[key];
    if (a !== b && !(a == null && b == null)) {
      fields.push(key);
    }
  }

  if (fields.length === 0) return null;
  return {
    gameId,
    issue: "mismatch",
    firestore: expected,
    rtdb: actual,
    fields,
  };
}

/**
 * Compare Firestore games catalog against player-backend game flags
 * (RTDB `gameFlags/*` or D1 `game_flags` depending on PLAYER_DATA_BACKEND).
 * When `repair` is true, sync missing/mismatched flags and delete orphans.
 */
export async function reconcileGameFlags(options?: {
  repair?: boolean;
}): Promise<ReconcileGameFlagsReport> {
  const repair = options?.repair === true;
  invalidateGameFlagsCache();

  const games = await fetchGamesFromServer();
  const flagIds = new Set(await listGameGatingFlagIds());

  const missing: GatingMismatch[] = [];
  const mismatches: GatingMismatch[] = [];
  const orphans: GatingMismatch[] = [];
  const repaired: string[] = [];

  const firestoreIds = new Set(games.map((g) => g.id));

  for (const game of games) {
    const expected = flagsFromGame(game);
    const actual = await fetchGameGatingFlagsFromRtdb(game.id);

    if (!actual) {
      missing.push({
        gameId: game.id,
        issue: "missing_rtdb",
        firestore: expected,
        rtdb: null,
      });
      if (repair) {
        await syncGameGatingFlagsToRtdb(game.id, expected);
        repaired.push(game.id);
      }
      continue;
    }

    const mismatch = compareFlags(game.id, expected, actual);
    if (mismatch) {
      mismatches.push(mismatch);
      if (repair) {
        await syncGameGatingFlagsToRtdb(game.id, expected);
        repaired.push(game.id);
      }
    }
  }

  for (const id of flagIds) {
    if (firestoreIds.has(id)) continue;
    orphans.push({
      gameId: id,
      issue: "orphan_rtdb",
      firestore: null,
      rtdb: await fetchGameGatingFlagsFromRtdb(id),
    });
    if (repair) {
      await deleteGameGatingFlagsFromRtdb(id);
      repaired.push(id);
    }
  }

  return {
    firestoreCount: games.length,
    rtdbFlagCount: flagIds.size,
    missing,
    orphans,
    mismatches,
    repaired,
  };
}
