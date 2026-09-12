import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

const ADMIN_HOST = (process.env.NEXT_PUBLIC_ADMIN_HOST ?? "").toLowerCase();

function hostFromRequest(request: NextRequest): string {
  return (request.headers.get("host") ?? "").split(":")[0].toLowerCase();
}

function isAdminHost(host: string): boolean {
  return Boolean(ADMIN_HOST) && host === ADMIN_HOST;
}

export function middleware(request: NextRequest) {
  const host = hostFromRequest(request);
  const { pathname } = request.nextUrl;
  const onAdminHost = isAdminHost(host);

  if (onAdminHost) {
    if (pathname.startsWith("/api/")) {
      return NextResponse.next();
    }
    if (pathname === "/" || pathname.startsWith("/game")) {
      return NextResponse.redirect(new URL("/admin", request.url));
    }
    if (!pathname.startsWith("/admin")) {
      return NextResponse.redirect(new URL("/admin", request.url));
    }
    return NextResponse.next();
  }

  if (ADMIN_HOST && pathname.startsWith("/admin")) {
    return NextResponse.redirect(new URL("/", request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/", "/admin/:path*", "/game/:path*"],
};
