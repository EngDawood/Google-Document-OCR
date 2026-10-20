CREATE TABLE IF NOT EXISTS usage (
  period TEXT PRIMARY KEY,        -- 'm:2026-10' or 'd:2026-10-20' (UTC)
  pages  INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS jobs (
  id          TEXT PRIMARY KEY,
  filename    TEXT NOT NULL,
  mime_type   TEXT NOT NULL,
  pages       INTEGER NOT NULL,
  status      TEXT NOT NULL,      -- 'processing' | 'done' | 'failed'
  error       TEXT,
  options     TEXT NOT NULL,      -- JSON of the OCR options used
  meta        TEXT,               -- JSON: per-page quality scores, languages, char counts
  created_at  INTEGER NOT NULL,   -- unix ms
  expires_at  INTEGER NOT NULL    -- unix ms
);

CREATE INDEX IF NOT EXISTS jobs_expires_at ON jobs (expires_at);
CREATE INDEX IF NOT EXISTS jobs_created_at ON jobs (created_at);
