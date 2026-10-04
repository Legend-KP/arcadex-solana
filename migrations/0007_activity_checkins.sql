-- Daily streak check-in XP counters (10 XP per check-in).

ALTER TABLE user_activity ADD COLUMN check_ins INTEGER NOT NULL DEFAULT 0;
ALTER TABLE activity_leaderboard_entries ADD COLUMN check_ins INTEGER NOT NULL DEFAULT 0;
ALTER TABLE user_xp_all_time ADD COLUMN check_ins INTEGER NOT NULL DEFAULT 0;
