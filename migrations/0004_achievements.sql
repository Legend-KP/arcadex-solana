-- Achievements live in D1 only. XP changes when a player claims a mission.
-- Apply: npx wrangler d1 migrations apply arcadex-celo-preview --remote

ALTER TABLE users ADD COLUMN xp INTEGER NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS missions (
  id TEXT PRIMARY KEY NOT NULL,
  game_id TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  type TEXT NOT NULL,
  threshold INTEGER NOT NULL,
  mode TEXT NOT NULL DEFAULT '',
  xp_reward INTEGER NOT NULL,
  active INTEGER NOT NULL DEFAULT 1,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_missions_active
  ON missions (active, sort_order, created_at);

CREATE TABLE IF NOT EXISTS achievement_claims (
  wallet TEXT NOT NULL,
  mission_id TEXT NOT NULL,
  claimed_at INTEGER NOT NULL,
  xp_awarded INTEGER NOT NULL,
  PRIMARY KEY (wallet, mission_id)
);
