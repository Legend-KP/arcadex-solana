-- Hot-path game gating (Firestore mirror) + weekly activity leaderboard.

CREATE TABLE IF NOT EXISTS game_flags (
  game_id TEXT PRIMARY KEY NOT NULL,
  active INTEGER NOT NULL DEFAULT 1,
  live INTEGER NOT NULL DEFAULT 1,
  has_leaderboard INTEGER NOT NULL DEFAULT 1,
  contest_live INTEGER NOT NULL DEFAULT 0,
  contest_duration_days INTEGER,
  contest_task TEXT,
  contest_started_at INTEGER,
  contest_ends_at INTEGER
);

CREATE TABLE IF NOT EXISTS user_activity (
  wallet TEXT NOT NULL,
  week_id TEXT NOT NULL,
  sparks_spent INTEGER NOT NULL DEFAULT 0,
  active_days INTEGER NOT NULL DEFAULT 0,
  txs INTEGER NOT NULL DEFAULT 0,
  spend_units INTEGER NOT NULL DEFAULT 0,
  last_active_day TEXT,
  last_play_at INTEGER,
  updated_at INTEGER,
  name TEXT,
  PRIMARY KEY (wallet, week_id)
);

CREATE TABLE IF NOT EXISTS activity_leaderboard_entries (
  week_id TEXT NOT NULL,
  wallet TEXT NOT NULL,
  name TEXT NOT NULL,
  score INTEGER NOT NULL,
  sparks_spent INTEGER NOT NULL DEFAULT 0,
  active_days INTEGER NOT NULL DEFAULT 0,
  txs INTEGER NOT NULL DEFAULT 0,
  spend_units INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER,
  PRIMARY KEY (week_id, wallet)
);

CREATE INDEX IF NOT EXISTS idx_activity_lb_score
  ON activity_leaderboard_entries (week_id, score DESC, updated_at ASC);
