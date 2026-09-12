/**
 * Per-isolate rate limiting (in-memory).
 * Not global across Cloudflare locations — KV is reserved for catalog,
 * play counts, and streak cache.
 */

type RateBucket = { count: number; resetAt: number };

const memoryBuckets = new Map<string, RateBucket>();

export function getClientIp(request: Request): string {
  return (
    request.headers.get("cf-connecting-ip") ??
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    "unknown"
  );
}

function memoryCheck(key: string, limit: number, windowMs: number): boolean {
  const now = Date.now();
  const bucket = memoryBuckets.get(key);

  if (!bucket || now > bucket.resetAt) {
    memoryBuckets.set(key, { count: 1, resetAt: now + windowMs });
    return true;
  }

  if (bucket.count >= limit) {
    return false;
  }

  bucket.count += 1;
  return true;
}

/** Returns true if the request is allowed. */
export async function checkRateLimit(
  key: string,
  limit: number,
  windowMs: number
): Promise<boolean> {
  return memoryCheck(key, limit, windowMs);
}

/** Returns false if any key in the group is over limit. */
export async function checkRateLimitGroup(
  keys: string[],
  limit: number,
  windowMs: number
): Promise<boolean> {
  for (const key of keys) {
    if (!(await checkRateLimit(key, limit, windowMs))) {
      return false;
    }
  }
  return true;
}

export function rateLimitResponse(): Response {
  return Response.json(
    { error: "Too many requests. Please try again later." },
    { status: 429 }
  );
}
