/** Client-only: hide Daily Shuffle UI after a successful spin today (UTC). */

function utcDayKey(nowMs: number = Date.now()): string {
  return String(Math.floor(nowMs / 86_400_000));
}

function storageKey(wallet: string, campaignId: number): string {
  return `arcadex_shuffle_done_v1:${wallet.toLowerCase()}:${campaignId}:${utcDayKey()}`;
}

function canUseStorage(): boolean {
  return typeof window !== "undefined" && typeof localStorage !== "undefined";
}

export function markShuffleDoneToday(
  wallet: string,
  campaignId: number
): void {
  if (!canUseStorage() || !wallet) return;
  try {
    localStorage.setItem(storageKey(wallet, campaignId), "1");
  } catch {
    // private mode / quota
  }
}

export function hasShuffleDoneToday(
  wallet: string,
  campaignId: number
): boolean {
  if (!canUseStorage() || !wallet) return false;
  try {
    return localStorage.getItem(storageKey(wallet, campaignId)) === "1";
  } catch {
    return false;
  }
}
