/** Client-only: Daily Streak auto-prompt once per UTC calendar day. */

function utcDayKey(now = Date.now()): string {
  return new Date(now).toISOString().slice(0, 10);
}

function storageKey(wallet: string, campaignId: number): string {
  return `arcadex_streak_prompted_utc:${wallet.trim()}:${campaignId}`;
}

function canUseStorage(): boolean {
  return typeof window !== "undefined" && typeof localStorage !== "undefined";
}

/** Mark that we already auto-prompted (or completed) for today's UTC day. */
export function markStreakPromptedToday(
  wallet: string,
  campaignId: number,
  now = Date.now()
): void {
  if (!canUseStorage() || !wallet) return;
  try {
    localStorage.setItem(storageKey(wallet, campaignId), utcDayKey(now));
  } catch {
    // private mode / quota
  }
}

/** True if the auto-prompt already ran for this wallet on today's UTC day. */
export function hasStreakPromptedToday(
  wallet: string,
  campaignId: number,
  now = Date.now()
): boolean {
  if (!canUseStorage() || !wallet) return false;
  try {
    const raw = localStorage.getItem(storageKey(wallet, campaignId));
    if (!raw) return false;
    return raw === utcDayKey(now);
  } catch {
    return false;
  }
}
