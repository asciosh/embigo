CREATE TABLE IF NOT EXISTS players (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  nickname TEXT NOT NULL UNIQUE COLLATE NOCASE,
  pin_salt TEXT NOT NULL,
  pin_hash TEXT NOT NULL,
  failed_attempts INTEGER NOT NULL DEFAULT 0,
  locked_until INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  player_id INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);

-- two puzzles per day: idx 1 and idx 2
CREATE TABLE IF NOT EXISTS scores (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  player_id INTEGER NOT NULL,
  day INTEGER NOT NULL,
  idx INTEGER NOT NULL,
  moves INTEGER NOT NULL,
  par INTEGER NOT NULL,
  creature TEXT NOT NULL,
  solution TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  UNIQUE (player_id, day, idx)
);

CREATE INDEX IF NOT EXISTS idx_scores_day ON scores (day, player_id);
