import { NextResponse } from "next/server";
import { getAdminPassword } from "@/lib/admin-auth";
import {
  adminSessionCookieHeader,
  clearAdminSessionCookieHeader,
  createAdminSessionToken,
} from "@/lib/admin-session";
import {
  checkRateLimit,
  getClientIp,
  rateLimitResponse,
} from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const ip = getClientIp(request);
  if (!(await checkRateLimit(`admin-login:${ip}`, 10, 15 * 60_000))) {
    return rateLimitResponse();
  }

  try {
    const body = (await request.json()) as { password?: string };
    const password = (body.password ?? "").trim();
    const expected = getAdminPassword();

    if (!password || password !== expected) {
      return NextResponse.json({ error: "Wrong password." }, { status: 401 });
    }

    const token = await createAdminSessionToken();
    const response = NextResponse.json({ ok: true });
    response.headers.set("Set-Cookie", adminSessionCookieHeader(token));
    return response;
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Login failed.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function DELETE() {
  const response = NextResponse.json({ ok: true });
  response.headers.set("Set-Cookie", clearAdminSessionCookieHeader());
  return response;
}
