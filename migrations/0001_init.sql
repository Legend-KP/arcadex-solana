-- ArcadeX hybrid player store (D1). Firestore keeps the games catalog.
-- Preview: arcadex-celo-preview. Production: arcadex-celo-prod (PLAYER_DATA_BACKEND=d1).

CREATE TABLE IF NOT EXISTS users (
  wallet TEXT PRIMARY KEY NOT NULL,
  name TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS sparks (
  wallet TEXT PRIMARY KEY NOT NULL,
  max INTEGER NOT NULL,
  regen_ms INTEGER NOT NULL,
  slots_json TEXT NOT NULL,
  infinite_until INTEGER,
  FOREIGN KEY (wallet) REFERENCES users(wallet)
);

CREATE TABLE IF NOT EXISTS game_progress (
  wallet TEXT NOT NULL,
  game_id TEXT NOT NULL,
  s INTEGER,
  l INTEGER,
  st_json TEXT,
  r INTEGER,
  PRIMARY KEY (wallet, game_id)
);

CREATE TABLE IF NOT EXISTS leaderboard_entries (
  game_id TEXT NOT NULL,
  player_key TEXT NOT NULL,
  name TEXT NOT NULL,
  score INTEGER NOT NULL,
  wallet TEXT,
  created_at INTEGER,
  PRIMARY KEY (game_id, player_key)
);

CREATE INDEX IF NOT EXISTS idx_leaderboard_score
  ON leaderboard_entries (game_id, score DESC);

CREATE TABLE IF NOT EXISTS contest_entries (
  game_id TEXT NOT NULL,
  contest_started_at INTEGER NOT NULL,
  wallet TEXT NOT NULL,
  name TEXT NOT NULL,
  score INTEGER NOT NULL,
  created_at INTEGER,
  PRIMARY KEY (game_id, contest_started_at, wallet)
);

CREATE INDEX IF NOT EXISTS idx_contest_score
  ON contest_entries (game_id, contest_started_at, score DESC);

CREATE TABLE IF NOT EXISTS payment_guards (
  tx_hash TEXT PRIMARY KEY NOT NULL,
  kind TEXT NOT NULL,
  wallet TEXT NOT NULL,
  extra_json TEXT,
  used_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS game_plays (
  game_id TEXT PRIMARY KEY NOT NULL,
  plays INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS shuffle_pending (
  wallet TEXT NOT NULL,
  campaign_id TEXT NOT NULL,
  nonce TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  consumed_at INTEGER,
  tx_hash TEXT,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (wallet, campaign_id, nonce)
);

CREATE TABLE IF NOT EXISTS shuffle_daily_budget (
  day_key TEXT PRIMARY KEY NOT NULL,
  spent_micro INTEGER NOT NULL DEFAULT 0,
  reservations_json TEXT NOT NULL DEFAULT '{}',
  confirmed_json TEXT NOT NULL DEFAULT '{}'
);

CREATE TABLE IF NOT EXISTS device_seen (
  wallet TEXT NOT NULL,
  device_hash TEXT NOT NULL,
  first_seen_at INTEGER NOT NULL,
  PRIMARY KEY (wallet, device_hash)
);

CREATE TABLE IF NOT EXISTS session_device (
  wallet TEXT PRIMARY KEY NOT NULL,
  hash TEXT NOT NULL,
  bound_at INTEGER NOT NULL
);
