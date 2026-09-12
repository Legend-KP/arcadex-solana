/**
 * Fail closed on missing secrets — never boot an insecure "trust the caller" mode.
 */

function isProductionRuntime(): boolean {
  return (
    process.env.NODE_ENV === "production" ||
    process.env.CF_PAGES === "1" ||
    Boolean(process.env.CF_WORKER)
  );
}

export function getMissingRequiredSecrets(): string[] {
  const missing: string[] = [];

  if (!process.env.WALLET_SESSION_SECRET?.trim()) {
    missing.push("WALLET_SESSION_SECRET");
  }

  if (
    !process.env.FIREBASE_PROJECT_ID?.trim() &&
    !process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID?.trim()
  ) {
    missing.push("FIREBASE_PROJECT_ID");
  }

  if (!process.env.FIREBASE_CLIENT_EMAIL?.trim()) {
    missing.push("FIREBASE_CLIENT_EMAIL");
  }

  if (!process.env.FIREBASE_PRIVATE_KEY?.trim()) {
    missing.push("FIREBASE_PRIVATE_KEY");
  }

  return missing;
}

/**
 * Throws in production when required secrets are missing.
 * Safe to call on Worker/isolate boot and before wallet auth.
 */
export function assertRequiredSecrets(): void {
  const missing = getMissingRequiredSecrets();
  if (missing.length === 0) return;

  const message = `Missing required secrets: ${missing.join(", ")}. Refusing to start in an insecure configuration.`;

  if (isProductionRuntime()) {
    throw new Error(message);
  }

  // Local dev: warn loudly but allow next dev without CF secrets until .env is filled.
  console.warn(`[ArcadeX] ${message}`);
}

export function assertWalletSessionSecretConfigured(): void {
  const secret = process.env.WALLET_SESSION_SECRET?.trim();
  if (!secret) {
    throw new Error(
      "WALLET_SESSION_SECRET is not configured. Wallet-authenticated routes refuse to run without it."
    );
  }
}
