import { NextResponse } from "next/server";
import {
  ADMIN_SESSION_COOKIE,
  parseCookieHeader,
  verifyAdminSessionToken,
} from "@/lib/admin-session";

/** Strip accidental quotes / whitespace from Cloudflare dashboard values. */
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

export function getAdminPassword(): string {
  const password = normalizeEnvSecret(process.env.ADMIN_PASSWORD);
  if (!password) {
    if (process.env.NODE_ENV === "production") {
      throw new Error(
        "ADMIN_PASSWORD is not set on the Worker. Add it under Cloudflare → Settings → Variables (not NEXT_PUBLIC_ADMIN_PASSWORD)."
      );
    }
    return "dev-admin-password-change-me";
  }
  return password;
}

export async function verifyAdminRequest(request: Request): Promise<boolean> {
  const cookieToken = parseCookieHeader(
    request.headers.get("Cookie"),
    ADMIN_SESSION_COOKIE
  );
  if (cookieToken && (await verifyAdminSessionToken(cookieToken))) {
    return true;
  }

  const auth = request.headers.get("Authorization");
  if (auth?.startsWith("Bearer ")) {
    const token = auth.slice(7).trim();
    if (token && (await verifyAdminSessionToken(token))) {
      return true;
    }
  }

  return false;
}

export function unauthorizedResponse() {
  return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
}

export function apiErrorResponse(err: unknown, fallback: string) {
  const message = err instanceof Error ? err.message : fallback;
  return NextResponse.json({ error: message }, { status: 500 });
}
