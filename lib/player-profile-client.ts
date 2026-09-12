import { PlayerProfile } from "@/types";
import { encodeUserId } from "@/lib/wallet-address";
import { setCachedPlayerName } from "@/lib/player-id";
import { isArcadeXRewardsConfigured } from "@/lib/arcadex-rewards";
import { refreshSessionFromCheckIn } from "@/lib/streak-client";
import { walletAuthHeaders } from "@/lib/wallet-session-client";

export async function fetchPlayerProfile(
  playerId: string
): Promise<PlayerProfile | null> {
  const res = await fetch(`/api/users/${encodeUserId(playerId)}`, {
    cache: "no-store",
    headers: walletAuthHeaders(),
  });
  const data = (await res.json()) as { user?: PlayerProfile | null; error?: string };

  if (!res.ok) {
    throw new Error(data.error ?? "Could not load player profile.");
  }

  const user = data.user ?? null;
  if (user?.name) setCachedPlayerName(user.name);
  return user;
}

export async function savePlayerProfile(
  playerId: string,
  name: string,
  walletAddress?: string
): Promise<PlayerProfile> {
  const res = await fetch(`/api/users/${encodeUserId(playerId)}`, {
    method: "PUT",
    headers: walletAuthHeaders(),
    body: JSON.stringify({ name, walletAddress }),
  });

  const text = await res.text();
  let data: { user?: PlayerProfile; error?: string };
  try {
    data = JSON.parse(text) as { user?: PlayerProfile; error?: string };
  } catch {
    throw new Error(
      res.ok
        ? "Could not save player profile."
        : `Could not save player profile (${res.status}).`
    );
  }

  if (!res.ok || !data.user) {
    throw new Error(data.error ?? "Could not save player profile.");
  }

  setCachedPlayerName(data.user.name);
  return data.user;
}

export async function bootstrapPlayerProfile(
  walletAddress: string
): Promise<PlayerProfile> {
  async function once() {
    const res = await fetch("/api/bootstrap", {
      method: "POST",
      headers: walletAuthHeaders(),
      body: JSON.stringify({ walletAddress }),
    });

    const data = (await res.json()) as { user?: PlayerProfile; error?: string };
    return { res, data };
  }

  let { res, data } = await once();

  if (!res.ok && res.status === 401 && isArcadeXRewardsConfigured()) {
    try {
      await refreshSessionFromCheckIn(walletAddress);
      ({ res, data } = await once());
    } catch {
      // Keep original bootstrap error
    }
  }

  if (!res.ok || !data.user) {
    throw new Error(data.error ?? "Could not bootstrap player profile.");
  }

  if (data.user.name) setCachedPlayerName(data.user.name);
  return data.user;
}
