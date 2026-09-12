/** Shared AbortController timeouts for Firestore / RTDB REST calls. */

export const FIREBASE_FETCH_TIMEOUT_MS = 8_000;

export class FirebaseTimeoutError extends Error {
  constructor(timeoutMs: number) {
    super(`Firebase request timed out after ${timeoutMs}ms`);
    this.name = "FirebaseTimeoutError";
  }
}

/**
 * fetch() with a hard deadline. Prefer this for all Firebase REST calls so a
 * hung backend cannot hold a Worker isolate until the platform kills it.
 */
export async function fetchWithTimeout(
  url: string,
  init?: RequestInit,
  timeoutMs: number = FIREBASE_FETCH_TIMEOUT_MS
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(url, {
      ...init,
      signal: controller.signal,
      cache: init?.cache ?? "no-store",
    });
  } catch (err) {
    if (
      (err instanceof Error && err.name === "AbortError") ||
      (typeof DOMException !== "undefined" &&
        err instanceof DOMException &&
        err.name === "AbortError")
    ) {
      throw new FirebaseTimeoutError(timeoutMs);
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}
