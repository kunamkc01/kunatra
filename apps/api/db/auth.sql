-- Kunatra — users & roles.
-- Each user belongs to one household. Owners get full access; operations users
-- get operational access (assets/work-orders/vendors/inspections), with financial
-- totals hidden. Idempotent.

CREATE TABLE IF NOT EXISTS users (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id  UUID NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  email         TEXT NOT NULL UNIQUE,          -- stored lowercased
  password_hash TEXT NOT NULL,                 -- scrypt: saltHex:hashHex
  full_name     TEXT,
  role          TEXT NOT NULL CHECK (role IN ('owner','operations')),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_users_household ON users(household_id);
