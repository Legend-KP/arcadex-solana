const KEY = "arcadex_recent_plays";
const MAX = 12;

export function readRecentPlayIds(): string[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((id): id is string => typeof id === "string" && id.length > 0);
  } catch {
    return [];
  }
}

/** Local only — opening a game does not write progress or missions. */
export function rememberRecentPlay(gameId: string): void {
  if (typeof window === "undefined") return;
  const id = gameId.trim();
  if (!id) return;
  const next = [id, ...readRecentPlayIds().filter((item) => item !== id)].slice(0, MAX);
  window.localStorage.setItem(KEY, JSON.stringify(next));
}
