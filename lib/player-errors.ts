/** Shared player-store errors (RTDB + D1). */

export class SparkSpendError extends Error {
  constructor(
    message: string,
    public readonly code: "NO_SPARKS" | "NO_WALLET"
  ) {
    super(message);
    this.name = "SparkSpendError";
  }
}

export class GameStateConflictError extends Error {
  revision: number;
  state: Record<string, unknown> | null;

  constructor(revision: number, state: Record<string, unknown> | null) {
    super("Game state revision conflict.");
    this.name = "GameStateConflictError";
    this.revision = revision;
    this.state = state;
  }
}
