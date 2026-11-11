-- Ragnaduck online: players and runs. Run once against the Neon database.

CREATE TABLE IF NOT EXISTS users (
  id          BIGSERIAL PRIMARY KEY,
  github_id   BIGINT NOT NULL UNIQUE,
  name        TEXT NOT NULL,
  avatar_url  TEXT,
  banned      BOOLEAN NOT NULL DEFAULT FALSE,   -- hides the player from the leaderboard
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- One row per run. It is created when the run starts (the row id is the run ticket)
-- and filled in when the run ends. A run with `flagged` set failed the plausibility
-- checks: it is kept for review but never shown.
CREATE TABLE IF NOT EXISTS runs (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  started_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at  TIMESTAMPTZ,
  score        INTEGER,
  wave         INTEGER,
  kills        INTEGER,
  max_combo    INTEGER,
  duration_ms  INTEGER,
  summary      JSONB,
  flagged      TEXT
);

CREATE INDEX IF NOT EXISTS runs_user_started ON runs (user_id, started_at DESC);
CREATE INDEX IF NOT EXISTS runs_board ON runs (score DESC) WHERE flagged IS NULL AND score IS NOT NULL;
