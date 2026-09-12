export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME === "edge") {
    return;
  }

  // Keep instrumentation lightweight — full secret assert runs in API routes
  // (requireWalletAuth). Avoids heavy dynamic imports during page SSR boot.
  const missing: string[] = [];
  if (!process.env.WALLET_SESSION_SECRET?.trim()) {
    missing.push("WALLET_SESSION_SECRET");
  }

  if (missing.length > 0 && process.env.NODE_ENV === "production") {
    console.error(
      `[ArcadeX] Missing secrets: ${missing.join(", ")}. Auth routes will return 503 until configured.`
    );
  }

  if (process.env.FIREBASE_DATABASE_SECRET?.trim() && process.env.NODE_ENV === "production") {
    console.error(
      "[ArcadeX][SECURITY][RTDB_AUTH] FIREBASE_DATABASE_SECRET is configured. Rotate and remove this legacy credential."
    );
  }
}
