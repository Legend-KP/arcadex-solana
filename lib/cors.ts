import { NextResponse } from "next/server";

const ALLOWED_METHODS = "GET, POST, PUT, OPTIONS";
const ALLOWED_HEADERS = "Content-Type, Authorization";

function getShellOrigin(): string | null {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL?.trim();
  if (!appUrl) return null;
  return appUrl.startsWith("http") ? appUrl : `https://${appUrl}`;
}

function getAllowedCorsOrigins(): Set<string> {
  const origins = new Set<string>();

  for (const entry of process.env.ALLOWED_CORS_ORIGINS?.split(",") ?? []) {
    const trimmed = entry.trim();
    if (trimmed) origins.add(trimmed);
  }

  const shellOrigin = getShellOrigin();
  if (shellOrigin) origins.add(shellOrigin);

  if (process.env.NODE_ENV !== "production") {
    origins.add("http://localhost:3000");
    origins.add("http://127.0.0.1:3000");
  }

  return origins;
}

/** This Worker’s own URL (production or branch preview). */
function getRequestSelfOrigin(request: Request): string | null {
  try {
    return new URL(request.url).origin;
  } catch {
    return null;
  }
}

/**
 * Branch preview hosts look like:
 * https://feature-hybrid-d1-kv-arcadex-celo.<account>.workers.dev
 */
function isArcadeXWorkersPreviewOrigin(origin: string): boolean {
  try {
    const { hostname } = new URL(origin);
    return (
      hostname.endsWith(".workers.dev") && hostname.includes("arcadex-celo")
    );
  } catch {
    return false;
  }
}

function isOriginAllowed(origin: string | null, request?: Request): boolean {
  if (!origin) return false;

  const allowlist = getAllowedCorsOrigins();
  if (allowlist.has(origin)) return true;

  // Same Worker origin (needed for branch preview URLs — APP_URL is production only).
  const selfOrigin = request ? getRequestSelfOrigin(request) : null;
  if (selfOrigin && origin === selfOrigin) return true;

  if (isArcadeXWorkersPreviewOrigin(origin)) return true;

  // Game CDNs live on trenchverse (Unity often calls shell APIs directly).
  try {
    const { hostname } = new URL(origin);
    if (
      hostname === "trenchverse.com" ||
      hostname.endsWith(".trenchverse.com")
    ) {
      return true;
    }
  } catch {
    // ignore invalid Origin
  }

  // Optional suffix match for other game CDNs, e.g. ".pages.dev"
  const suffix = process.env.ALLOWED_CORS_ORIGIN_SUFFIX?.trim();
  if (suffix && origin.endsWith(suffix)) return true;

  return false;
}

/** CORS headers so Unity WebGL (game CDN origin) can call shell APIs directly. */
export function corsHeaders(request: Request): HeadersInit {
  const origin = request.headers.get("Origin");
  const headers: Record<string, string> = {
    "Access-Control-Allow-Methods": ALLOWED_METHODS,
    "Access-Control-Allow-Headers": ALLOWED_HEADERS,
  };

  if (origin && isOriginAllowed(origin, request)) {
    headers["Access-Control-Allow-Origin"] = origin;
    headers["Vary"] = "Origin";
  }

  return headers;
}

export function handleCorsPreflightRequest(request: Request): NextResponse {
  const origin = request.headers.get("Origin");
  if (origin && !isOriginAllowed(origin, request)) {
    return new NextResponse(null, { status: 403 });
  }

  return new NextResponse(null, {
    status: 204,
    headers: corsHeaders(request),
  });
}

export function corsJsonResponse(
  request: Request,
  data: unknown,
  init?: ResponseInit
): NextResponse {
  const origin = request.headers.get("Origin");
  if (origin && !isOriginAllowed(origin, request)) {
    return NextResponse.json(
      { error: "Origin not allowed." },
      { status: 403 }
    );
  }

  const headers = new Headers(init?.headers);
  const cors = corsHeaders(request);
  for (const [key, value] of Object.entries(cors)) {
    headers.set(key, value);
  }

  return NextResponse.json(data, {
    ...init,
    headers,
  });
}
