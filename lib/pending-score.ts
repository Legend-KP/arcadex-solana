const PREFIX = "arcadex_pending_score:";

export function setPendingScore(gameId: string, score: number): void {
  if (typeof window === "undefined") return;
  sessionStorage.setItem(`${PREFIX}${gameId}`, String(score));
}

export function getPendingScore(gameId: string): number {
  if (typeof window === "undefined") return 0;
  const raw = sessionStorage.getItem(`${PREFIX}${gameId}`);
  if (!raw) return 0;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

export function clearPendingScore(gameId: string): void {
  if (typeof window === "undefined") return;
  sessionStorage.removeItem(`${PREFIX}${gameId}`);
}
