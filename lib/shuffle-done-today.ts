/** Client-only: hide Daily Shuffle UI for 24h after a successful claim. */

export const SHUFFLE_CLIENT_COOLDOWN_MS = 24 * 60 * 60 * 1000;

function storageKey(wallet: string, campaignId: number): string {
  // Solana base58 is case-sensitive.
  return `arcadex_shuffle_done_v2:${wallet.trim()}:${campaignId}`;
}

function canUseStorage(): boolean {
  return typeof window !== "undefined" && typeof localStorage !== "undefined";
}

export function markShuffleDoneToday(
  wallet: string,
  campaignId: number,
  completedAtMs: number = Date.now()
): void {
  if (!canUseStorage() || !wallet) return;
  try {
    const at =
      Number.isFinite(completedAtMs) && completedAtMs > 0
        ? completedAtMs
        : Date.now();
    localStorage.setItem(storageKey(wallet, campaignId), String(at));
  } catch {
    // private mode / quota
  }
}

export function hasShuffleDoneToday(
  wallet: string,
  campaignId: number,
  now = Date.now()
): boolean {
  if (!canUseStorage() || !wallet) return false;
  try {
    const raw = localStorage.getItem(storageKey(wallet, campaignId));
    if (!raw) return false;
    const at = Number(raw);
    if (!Number.isFinite(at) || at <= 0) return false;
    return now - at < SHUFFLE_CLIENT_COOLDOWN_MS;
  } catch {
    return false;
  }
}

export function shuffleNextAvailableAt(
  wallet: string,
  campaignId: number
): number {
  if (!canUseStorage() || !wallet) return 0;
  try {
    const raw = localStorage.getItem(storageKey(wallet, campaignId));
    const at = Number(raw);
    if (!Number.isFinite(at) || at <= 0) return 0;
    return at + SHUFFLE_CLIENT_COOLDOWN_MS;
  } catch {
    return 0;
  }
}
