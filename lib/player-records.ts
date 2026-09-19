/** Shared player-store record shapes (RTDB + D1). */

export type GameStateRecord = {
  found: boolean;
  revision: number;
  state: Record<string, unknown> | null;
};
