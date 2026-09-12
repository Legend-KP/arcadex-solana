import { Game } from "@/types";

/** Lower sortOrder appears first; missing sortOrder falls back to createdAt (newest first). */
export function compareGames(a: Game, b: Game): number {
  const orderA = a.sortOrder ?? Number.MAX_SAFE_INTEGER;
  const orderB = b.sortOrder ?? Number.MAX_SAFE_INTEGER;
  if (orderA !== orderB) return orderA - orderB;
  return (b.createdAt ?? 0) - (a.createdAt ?? 0);
}

export function sortGames(games: Game[]): Game[] {
  return [...games].sort(compareGames);
}

export function nextGameSortOrder(games: Game[]): number {
  const maxOrder = games.reduce(
    (max, game) => Math.max(max, game.sortOrder ?? -1),
    -1
  );
  return maxOrder + 1;
}
