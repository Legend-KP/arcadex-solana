import { Game, PlayerProfile, SparkSnapshot, StoredSparkState } from "@/types";
import {
  isWalletAddress,
  normalizeWalletAddress,
} from "@/lib/wallet-address";
import { walletAuthHeaders } from "@/lib/wallet-session-client";

export type HomeShellPayload = {
  games: Game[];
  playCounts: Record<string, number>;
  user: PlayerProfile | null;
  state: StoredSparkState | null;
  sparks: SparkSnapshot | null;
};

const inflight = new Map<string, Promise<HomeShellPayload>>();
let last: { key: string; at: number; data: HomeShellPayload } | null = null;
const HOME_CLIENT_TTL_MS = 5_000;

function homeKey(walletAddress?: string): string {
  if (walletAddress && isWalletAddress(walletAddress)) {
    return normalizeWalletAddress(walletAddress);
  }
  return "*";
}

export async function fetchHomeShell(
  walletAddress?: string
): Promise<HomeShellPayload> {
  const key = homeKey(walletAddress);
  if (last && last.key === key && Date.now() - last.at < HOME_CLIENT_TTL_MS) {
    // Wallet home without sparks was likely pre-session — do not reuse it.
    if (key === "*" || last.data.state) return last.data;
  }

  const existing = inflight.get(key);
  if (existing) return existing;

  const promise = (async () => {
    const params =
      key !== "*"
        ? `?walletAddress=${encodeURIComponent(key)}`
        : "";
    const res = await fetch(`/api/home${params}`, {
      cache: "no-store",
      headers: walletAuthHeaders(),
    });
    const data = (await res.json()) as HomeShellPayload & { error?: string };
    if (!res.ok) {
      throw new Error(data.error ?? "Could not load ArcadeX.");
    }

    const payload: HomeShellPayload = {
      games: data.games ?? [],
      playCounts: data.playCounts ?? {},
      user: data.user ?? null,
      state: data.state ?? null,
      sparks: data.sparks ?? null,
    };
    last = { key, at: Date.now(), data: payload };
    return payload;
  })().finally(() => {
    inflight.delete(key);
  });

  inflight.set(key, promise);
  return promise;
}
