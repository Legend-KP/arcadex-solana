/**
 * Cached OpenNext Worker context — env bindings + waitUntil.
 * Prime this before returning a response, then scheduleWorkerWork() is sync.
 */

type WaitUntilFn = (promise: Promise<unknown>) => void;

type WorkerContext = {
  env: Record<string, unknown>;
  waitUntil: WaitUntilFn | null;
};

let cached: WorkerContext | null | undefined;

export async function getWorkerContext(): Promise<WorkerContext | null> {
  if (cached !== undefined) return cached;
  try {
    const { getCloudflareContext } = await import("@opennextjs/cloudflare");
    const raw = (await getCloudflareContext({ async: true })) as unknown as {
      env?: Record<string, unknown>;
      ctx?: { waitUntil?: WaitUntilFn };
    };
    cached = {
      env: (raw.env ?? {}) as Record<string, unknown>,
      waitUntil: raw.ctx?.waitUntil
        ? raw.ctx.waitUntil.bind(raw.ctx)
        : null,
    };
    return cached;
  } catch {
    cached = null;
    return null;
  }
}

/** Keep the isolate alive after the response (no-op in local `next dev`). */
export function scheduleWorkerWork(task: Promise<unknown>): void {
  const waitUntil = cached?.waitUntil;
  const guarded = task.catch((err) => {
    console.warn(
      "[ArcadeX] background Worker task failed:",
      err instanceof Error ? err.message : err
    );
  });
  if (waitUntil) {
    waitUntil(guarded);
    return;
  }
  void guarded;
}
