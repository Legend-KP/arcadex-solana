import {
  CONTEST_DURATION_OPTIONS,
  ContestDurationDays,
  ContestInfo,
  ContestStatus,
  Game,
  LeaderboardEntry,
} from "@/types";

const MS_PER_DAY = 24 * 60 * 60 * 1000;

export function isContestDurationDays(
  value: unknown
): value is ContestDurationDays {
  return (
    typeof value === "number" &&
    (CONTEST_DURATION_OPTIONS as readonly number[]).includes(value)
  );
}

export function computeContestEndsAt(
  startedAt: number,
  durationDays: ContestDurationDays
): number {
  return startedAt + durationDays * MS_PER_DAY;
}

export function getContestStatus(
  game: Pick<Game, "contestStartedAt" | "contestEndsAt">,
  now = Date.now()
): ContestStatus | null {
  const startedAt = game.contestStartedAt;
  const endsAt = game.contestEndsAt;
  if (
    typeof startedAt !== "number" ||
    typeof endsAt !== "number" ||
    !Number.isFinite(startedAt) ||
    !Number.isFinite(endsAt)
  ) {
    return null;
  }
  return endsAt > now ? "live" : "ended";
}

export function isContestActive(
  game: Pick<Game, "contestStartedAt" | "contestEndsAt">,
  now = Date.now()
): boolean {
  return getContestStatus(game, now) === "live";
}

export function formatContestCountdown(remainingMs: number): string {
  const totalSeconds = Math.max(0, Math.floor(remainingMs / 1000));
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (days > 0) {
    return `${days}d ${String(hours).padStart(2, "0")}h ${String(minutes).padStart(2, "0")}m`;
  }
  if (hours > 0) {
    return `${hours}h ${String(minutes).padStart(2, "0")}m ${String(seconds).padStart(2, "0")}s`;
  }
  return `${minutes}m ${String(seconds).padStart(2, "0")}s`;
}

export function buildContestInfo(
  game: Pick<
    Game,
    | "contestTask"
    | "contestStartedAt"
    | "contestEndsAt"
    | "contestDurationDays"
  >,
  entries: LeaderboardEntry[],
  now = Date.now()
): ContestInfo | null {
  const status = getContestStatus(game, now);
  const startedAt = game.contestStartedAt;
  const endsAt = game.contestEndsAt;
  if (!status || typeof startedAt !== "number" || typeof endsAt !== "number") {
    return null;
  }

  const durationDays =
    game.contestDurationDays &&
    isContestDurationDays(game.contestDurationDays)
      ? game.contestDurationDays
      : Math.max(1, Math.round((endsAt - startedAt) / MS_PER_DAY));

  return {
    status,
    task: game.contestTask?.trim() ?? "",
    startedAt,
    endsAt,
    durationDays: durationDays as ContestDurationDays,
    entries,
  };
}
