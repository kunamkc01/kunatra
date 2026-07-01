-- Kunatra — add the read-only 'advisor' role and the approval workflow.
-- Idempotent.

-- Widen the user-role check to include 'advisor' (read-only financial view).
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check;
ALTER TABLE users ADD CONSTRAINT users_role_check CHECK (role IN ('owner','operations','advisor'));

-- Approval requests: operations proposes, an owner approves or rejects.
DO $$ BEGIN
  CREATE TYPE approval_status AS ENUM ('pending','approved','rejected');
EXCEPTION WHEN duplicate_object THEN null; END $$;

CREATE TABLE IF NOT EXISTS approval_requests (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id      UUID NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  requested_by      TEXT,               -- actor email
  title             TEXT NOT NULL,
  amount_paise      BIGINT,             -- optional spend/change amount
  note              TEXT,
  status            approval_status NOT NULL DEFAULT 'pending',
  decided_by        TEXT,
  decision_note     TEXT,
  decided_at        TIMESTAMPTZ,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_approvals_household ON approval_requests(household_id, status, created_at DESC);
