-- Ragnaduck online: players and runs. Run once against the Neon database.
-- Accounts themselves live in the neon_auth schema, which Neon Auth manages.

CREATE TABLE IF NOT EXISTS players (
  id          BIGSERIAL PRIMARY KEY,            -- public id, safe to show
  user_id     TEXT NOT NULL UNIQUE,             -- neon_auth."user".id
  name        TEXT NOT NULL,                    -- display name on the leaderboard
  banned      BOOLEAN NOT NULL DEFAULT FALSE,   -- hides the player from the leaderboard
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- One row per run. It is created when the run starts (the row id is the run ticket)
-- and filled in when the run ends. A run with `flagged` set failed the plausibility
-- checks: it is kept for review but never shown.
CREATE TABLE IF NOT EXISTS runs (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  player_id    BIGINT NOT NULL REFERENCES players(id) ON DELETE CASCADE,
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

CREATE INDEX IF NOT EXISTS runs_player_started ON runs (player_id, started_at DESC);
CREATE INDEX IF NOT EXISTS runs_board ON runs (score DESC) WHERE flagged IS NULL AND score IS NOT NULL;
