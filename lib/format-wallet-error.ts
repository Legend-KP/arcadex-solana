/** Format wallet / payment errors for UI (Solana). */
export function formatWalletError(err: unknown, fallback = "Something went wrong."): string {
  if (!err) return fallback;
  if (typeof err === "string") return err.trim() || fallback;
  const msg = String((err as { message?: unknown })?.message || err || "").trim();
  return msg || fallback;
}
