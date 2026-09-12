import { walletAuthHeaders } from "@/lib/wallet-session-client";

export type GameStateResponse = {
  success: boolean;
  found: boolean;
  revision: number;
  state: Record<string, unknown> | null;
  conflict?: boolean;
  requestId?: string;
};

export async function getGameState(
  gameId: string,
  walletAddress: string
): Promise<GameStateResponse> {
  const params = new URLSearchParams({ wallet: walletAddress });
  const res = await fetch(`/api/games/${gameId}/state?${params}`, {
    headers: walletAuthHeaders(),
  });
  const data = (await res.json()) as GameStateResponse & { error?: string };

  if (!res.ok) {
    throw new Error(data.error ?? "Could not load game state.");
  }

  return {
    success: data.success ?? true,
    found: data.found === true,
    revision: data.revision ?? 0,
    state: data.state ?? null,
  };
}

export async function saveGameState(
  gameId: string,
  walletAddress: string,
  state: Record<string, unknown>,
  opts?: { baseRevision?: number; requestId?: string; merge?: boolean }
): Promise<GameStateResponse> {
  const res = await fetch(`/api/games/${gameId}/state`, {
    method: "POST",
    headers: walletAuthHeaders(),
    body: JSON.stringify({
      walletAddress,
      state,
      merge: opts?.merge === true,
      ...(typeof opts?.baseRevision === "number"
        ? { baseRevision: opts.baseRevision }
        : {}),
      ...(opts?.requestId ? { requestId: opts.requestId } : {}),
    }),
  });

  const data = (await res.json()) as GameStateResponse & { error?: string };

  if (!res.ok && res.status !== 409) {
    throw new Error(data.error ?? "Could not save game state.");
  }

  return {
    success: data.success === true && res.ok,
    found: data.found === true,
    revision: data.revision ?? 0,
    state: data.state ?? null,
    conflict: data.conflict === true || res.status === 409,
    requestId: data.requestId,
  };
}
