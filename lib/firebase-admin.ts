import { SignJWT, importPKCS8 } from "jose";
import { fetchWithTimeout } from "@/lib/firebase-fetch";

const FIREBASE_SCOPES =
  "https://www.googleapis.com/auth/datastore https://www.googleapis.com/auth/firebase.database https://www.googleapis.com/auth/userinfo.email";

/** Refresh a few minutes before Google's 1h expiry. */
const ACCESS_TOKEN_TTL_MS = 55 * 60 * 1000;

let cachedAccessToken: { token: string; expiresAt: number } | null = null;
/** In-flight refresh — concurrent callers share one mint. */
let accessTokenInFlight: Promise<string> | null = null;
/** Parsed once per warm isolate; avoid re-importing the PKCS8 key every refresh. */
let cachedPrivateKey: Awaited<ReturnType<typeof importPKCS8>> | null = null;
let warnedLegacyRtdbSecretConfigured = false;

export function getProjectId(): string {
  return (
    process.env.FIREBASE_PROJECT_ID ??
    process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID ??
    ""
  );
}

export function getServiceAccount() {
  const projectId = getProjectId();
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
  const privateKey = process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, "\n");

  if (!projectId || !clientEmail || !privateKey) {
    throw new Error(
      "Server Firebase credentials missing. Add FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL, and FIREBASE_PRIVATE_KEY as encrypted secrets in Cloudflare Worker settings, then redeploy."
    );
  }

  return { projectId, clientEmail, privateKey };
}

export function getDatabaseUrl(): string {
  const explicit = process.env.FIREBASE_DATABASE_URL?.trim();
  if (explicit) return explicit.replace(/\/$/, "");

  const projectId = getProjectId();
  if (!projectId) {
    throw new Error(
      "FIREBASE_DATABASE_URL or FIREBASE_PROJECT_ID is required for Realtime Database."
    );
  }

  return `https://${projectId}-default-rtdb.firebaseio.com`;
}

/** Strip secrets/tokens from strings that may be logged or returned to clients. */
export function scrubSecrets(text: string): string {
  return text
    .replace(/access_token=[^&\s"]+/gi, "access_token=REDACTED")
    .replace(/auth=[^&\s"]+/gi, "auth=REDACTED")
    .replace(/Bearer\s+[A-Za-z0-9._\-]+/gi, "Bearer REDACTED");
}

/**
 * Legacy RTDB database secrets are a high-risk credential.
 * Keep this as an operational warning until the secret is fully removed.
 */
export function warnIfLegacyRtdbSecretConfigured(): void {
  const secret = process.env.FIREBASE_DATABASE_SECRET?.trim();
  if (!secret || warnedLegacyRtdbSecretConfigured) return;
  warnedLegacyRtdbSecretConfigured = true;
  console.error(
    "[ArcadeX][SECURITY][RTDB_AUTH] FIREBASE_DATABASE_SECRET is still configured. Rotate and remove it; OAuth service-account auth is required."
  );
}

async function getServiceAccountKey(): Promise<
  Awaited<ReturnType<typeof importPKCS8>>
> {
  if (cachedPrivateKey) return cachedPrivateKey;
  const { privateKey } = getServiceAccount();
  cachedPrivateKey = await importPKCS8(privateKey, "RS256");
  return cachedPrivateKey;
}

async function mintFirebaseAccessToken(): Promise<string> {
  warnIfLegacyRtdbSecretConfigured();

  const { clientEmail } = getServiceAccount();
  const key = await getServiceAccountKey();

  const assertion = await new SignJWT({ scope: FIREBASE_SCOPES })
    .setProtectedHeader({ alg: "RS256", typ: "JWT" })
    .setIssuer(clientEmail)
    .setSubject(clientEmail)
    .setAudience("https://oauth2.googleapis.com/token")
    .setIssuedAt()
    .setExpirationTime("1h")
    .sign(key);

  const res = await fetchWithTimeout("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion,
    }),
  });

  const data = (await res.json()) as {
    access_token?: string;
    error?: string;
    error_description?: string;
  };
  if (!res.ok || !data.access_token) {
    const status = res.status;
    const err = data.error ?? "oauth_token_request_failed";
    const desc = data.error_description ?? "No OAuth error description provided.";
    throw new Error(
      `Could not obtain Google access token (${status} ${err}): ${scrubSecrets(desc)}`
    );
  }

  cachedAccessToken = {
    token: data.access_token,
    expiresAt: Date.now() + ACCESS_TOKEN_TTL_MS,
  };

  return data.access_token;
}

/**
 * OAuth access token for Firestore + RTDB REST.
 * Cached until near expiry; concurrent refreshers share one in-flight promise.
 * A failed mint clears the in-flight promise so the next caller can retry.
 */
export async function getFirebaseAccessToken(): Promise<string> {
  if (cachedAccessToken && Date.now() < cachedAccessToken.expiresAt) {
    return cachedAccessToken.token;
  }

  if (accessTokenInFlight) {
    return accessTokenInFlight;
  }

  accessTokenInFlight = mintFirebaseAccessToken()
    .catch((err) => {
      // Do not poison the cache — allow the next caller to retry.
      cachedAccessToken = null;
      throw err;
    })
    .finally(() => {
      accessTokenInFlight = null;
    });

  return accessTokenInFlight;
}
