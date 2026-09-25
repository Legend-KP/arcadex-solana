-- Marks this database as ArcadeX Solana. The app refuses any D1 row that is not solana,
-- so a Celo database binding cannot be used even if wrangler ids are copied.

CREATE TABLE IF NOT EXISTS data_plane (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  plane TEXT NOT NULL
);

INSERT INTO data_plane (id, plane) VALUES (1, 'solana')
ON CONFLICT(id) DO UPDATE SET plane = 'solana';
