-- Lifetime XP totals (written on every activity event; not shown in UI yet).

CREATE TABLE IF NOT EXISTS user_xp_all_time (
  wallet TEXT PRIMARY KEY NOT NULL,
  xp INTEGER NOT NULL DEFAULT 0,
  plays INTEGER NOT NULL DEFAULT 0,
  active_days INTEGER NOT NULL DEFAULT 0,
  txs INTEGER NOT NULL DEFAULT 0,
  spend_units INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER
);

CREATE INDEX IF NOT EXISTS idx_user_xp_all_time_xp
  ON user_xp_all_time (xp DESC, updated_at ASC);
