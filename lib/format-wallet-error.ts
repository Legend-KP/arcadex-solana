/** Format wallet / payment errors for UI (Solana). */
export function formatWalletError(
  err: unknown,
  fallback = "Something went wrong."
): string {
  if (!err) return fallback;
  if (typeof err === "string") return shorten(err.trim() || fallback);
  const msg = String(
    (err as { message?: unknown })?.message || err || ""
  ).trim();
  return shorten(msg || fallback);
}

function shorten(msg: string): string {
  const lower = msg.toLowerCase();

  if (lower.includes("prize wallet has no usdt")) {
    return "Prize wallet is out of USDT. Please try again later.";
  }
  if (lower.includes("usdt balance too low")) {
    return "Prize wallet USDT balance is too low. Please try again later.";
  }
  if (lower.includes("needs more sol")) {
    return "Prize wallet needs SOL for network fees. Please try again later.";
  }
  if (
    lower.includes("invalid account data") ||
    lower.includes("invalid token account")
  ) {
    return "Could not send USDT (token account issue). Tap Claim again, or try later.";
  }
  if (lower.includes("already shuffled")) {
    return "Already shuffled in the last 24 hours. Come back later.";
  }

  // Strip verbose Solana simulation dumps.
  if (msg.length > 180 || lower.includes("simulation failed")) {
    const first = msg.split(/Logs:|Catch the/i)[0]?.trim() || msg;
    return first.length > 180 ? `${first.slice(0, 177)}…` : first;
  }
  return msg;
}
