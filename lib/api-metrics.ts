import { getGameCacheStats } from "@/lib/game-cache";
import { scrubSecrets } from "@/lib/firebase-admin";

export type ApiMetricEvent = {
  endpoint: string;
  method?: string;
  status?: number;
  durationMs?: number;
  firestoreReads?: number;
  cacheHit?: boolean;
  cacheLayer?: "list" | "doc" | "http" | "progress_debounce";
  rateLimited?: boolean;
  wallet?: string;
  gameId?: string;
};

export function recordApiMetric(event: ApiMetricEvent): void {
  const payload = {
    type: "arcadex_api_metric",
    ts: Date.now(),
    cache: getGameCacheStats(),
    ...event,
  };

  // Never log secrets/tokens even if a field is ever polluted.
  console.log(scrubSecrets(JSON.stringify(payload)));
}
