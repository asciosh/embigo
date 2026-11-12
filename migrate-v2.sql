-- Run this ONCE in the D1 console of an existing database (it replaces the old scores table;
-- old test scores are deleted, players and logins are kept).
DROP TABLE IF EXISTS scores;

CREATE TABLE scores (
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

CREATE INDEX idx_scores_day ON scores (day, player_id);
