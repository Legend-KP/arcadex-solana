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

export class InfiniteSparkActivationError extends Error {
  constructor(
    message: string,
    public readonly code: "NO_WALLET" | "INVALID_TX" | "TX_ALREADY_USED"
  ) {
    super(message);
    this.name = "InfiniteSparkActivationError";
  }
}

export class SparkRefillActivationError extends Error {
  constructor(
    message: string,
    public readonly code: "NO_WALLET" | "INVALID_TX" | "TX_ALREADY_USED"
  ) {
    super(message);
    this.name = "SparkRefillActivationError";
  }
}

export class ScoreSubmitActivationError extends Error {
  constructor(
    message: string,
    public readonly code:
      | "NO_WALLET"
      | "NO_NAME"
      | "INVALID_TX"
      | "TX_ALREADY_USED"
      | "NO_SCORE"
  ) {
    super(message);
    this.name = "ScoreSubmitActivationError";
  }
}

export class StreakSyncError extends Error {
  constructor(
    message: string,
    public readonly code: "NO_WALLET" | "INVALID_TX" | "TX_ALREADY_USED"
  ) {
    super(message);
    this.name = "StreakSyncError";
  }
}

export class StreakRewardError extends Error {
  constructor(
    message: string,
    public readonly code:
      | "NO_WALLET"
      | "INVALID_TX"
      | "TX_ALREADY_USED"
      | "NO_MILESTONE"
  ) {
    super(message);
    this.name = "StreakRewardError";
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
