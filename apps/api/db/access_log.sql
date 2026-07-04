-- Kunatra — login/access telemetry. One row per auth event (register / login /
-- household switch), success or failure, with CloudFront-derived geography and
-- a parsed device fingerprint. Lat/lon are rounded (~11km) for privacy.
-- Idempotent.

CREATE TABLE IF NOT EXISTS login_events (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      UUID REFERENCES users(id) ON DELETE CASCADE,  -- null when the email didn't match
  email        TEXT NOT NULL,
  event        TEXT NOT NULL CHECK (event IN ('register','login','switch')),
  success      BOOLEAN NOT NULL DEFAULT true,
  method       TEXT NOT NULL DEFAULT 'password',             -- passkey/google later
  ip           TEXT,
  country      CHAR(2),
  country_name TEXT,
  region       TEXT,        -- state/province
  city         TEXT,
  time_zone    TEXT,
  asn          TEXT,        -- ISP/network
  lat          NUMERIC(5,1),
  lon          NUMERIC(5,1),
  browser      TEXT,
  os           TEXT,
  device       TEXT,        -- mobile | desktop | tablet | other
  user_agent   TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()            -- UTC
);
CREATE INDEX IF NOT EXISTS idx_login_events_user ON login_events(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_login_events_time ON login_events(created_at DESC);

-- Lightweight "last access" on the account (heartbeat-updated, throttled).
ALTER TABLE users ADD COLUMN IF NOT EXISTS last_seen_at TIMESTAMPTZ;
ALTER TABLE users ADD COLUMN IF NOT EXISTS last_country TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS last_city TEXT;
