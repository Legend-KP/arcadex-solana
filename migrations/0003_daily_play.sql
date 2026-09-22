-- Daily streak + shuffle completions (Solana).
-- shuffle_pending / shuffle_daily_budget already exist in 0001_init.sql.

CREATE TABLE IF NOT EXISTS streak_progress (
  wallet TEXT NOT NULL,
  campaign_id TEXT NOT NULL,
  current_day INTEGER NOT NULL DEFAULT 0,
  last_check_in_at INTEGER NOT NULL DEFAULT 0,
  last_check_in_day_key TEXT NOT NULL DEFAULT '',
  required_days INTEGER NOT NULL DEFAULT 7,
  milestone_claimed INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (wallet, campaign_id)
);

CREATE TABLE IF NOT EXISTS daily_play_completions (
  wallet TEXT NOT NULL,
  campaign_id TEXT NOT NULL,
  day_key TEXT NOT NULL,
  mode TEXT NOT NULL,
  outcome_id TEXT,
  payout_signature TEXT,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (wallet, campaign_id, day_key, mode)
);

CREATE INDEX IF NOT EXISTS idx_daily_play_day
  ON daily_play_completions (day_key, mode);
