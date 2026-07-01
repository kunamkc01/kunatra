-- Kunatra — audit trail. Every create/update/delete records who did it and when,
-- so delegation is safe and nothing is silent. Idempotent.

CREATE TABLE IF NOT EXISTS audit_log (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id  UUID NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  actor_email   TEXT,
  actor_role    TEXT,
  action        TEXT NOT NULL,        -- created / updated / deleted
  entity_type   TEXT NOT NULL,        -- asset / loan / member / work order / …
  entity_id     TEXT,
  label         TEXT,                 -- best-effort human label
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_audit_household ON audit_log(household_id, created_at DESC);
