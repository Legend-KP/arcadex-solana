import { SignJWT, jwtVerify } from "jose";

export const ADMIN_SESSION_COOKIE = "arcadex_admin_session";
const ADMIN_SESSION_TTL_SEC = 8 * 60 * 60;

function normalizeEnvSecret(value: string | undefined): string {
  const trimmed = value?.trim() ?? "";
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1).trim();
  }
  return trimmed;
}

function getAdminSessionSecret(): Uint8Array {
  // Prefer a dedicated session secret; fall back to ADMIN_PASSWORD so login
  // works when only the portal password is configured in Cloudflare vars.
  const secret =
    normalizeEnvSecret(process.env.ADMIN_SESSION_SECRET) ||
    normalizeEnvSecret(process.env.WALLET_SESSION_SECRET) ||
    normalizeEnvSecret(process.env.ADMIN_PASSWORD);

  if (!secret) {
    if (process.env.NODE_ENV === "production") {
      throw new Error(
        "Set ADMIN_PASSWORD (or ADMIN_SESSION_SECRET) on the Cloudflare Worker."
      );
    }
    return new TextEncoder().encode("dev-admin-session-secret-change-me");
  }

  return new TextEncoder().encode(secret);
}

export async function createAdminSessionToken(): Promise<string> {
  return new SignJWT({ role: "admin" })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${ADMIN_SESSION_TTL_SEC}s`)
    .sign(getAdminSessionSecret());
}

export async function verifyAdminSessionToken(
  token: string
): Promise<boolean> {
  try {
    const { payload } = await jwtVerify(token, getAdminSessionSecret());
    return payload.role === "admin";
  } catch {
    return false;
  }
}

export function parseCookieHeader(
  cookieHeader: string | null,
  name: string
): string | null {
  if (!cookieHeader) return null;

  for (const part of cookieHeader.split(";")) {
    const [rawKey, ...rest] = part.trim().split("=");
    if (rawKey === name) {
      const value = rest.join("=").trim();
      return value || null;
    }
  }

  return null;
}

export function adminSessionCookieHeader(token: string): string {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  return `${ADMIN_SESSION_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${ADMIN_SESSION_TTL_SEC}${secure}`;
}

export function clearAdminSessionCookieHeader(): string {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  return `${ADMIN_SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure}`;
}
