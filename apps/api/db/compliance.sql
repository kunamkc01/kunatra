-- Kunatra — compliance calendar. Due dates for property tax, insurance/AMC
-- renewals and inspections, so nothing quietly slips. Idempotent.

DO $$ BEGIN
  CREATE TYPE compliance_kind AS ENUM ('property_tax','insurance','amc','inspection','renewal','other');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE recurrence AS ENUM ('none','monthly','quarterly','yearly');
EXCEPTION WHEN duplicate_object THEN null; END $$;

CREATE TABLE IF NOT EXISTS compliance_items (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id  UUID NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  asset_id      UUID REFERENCES assets(id) ON DELETE SET NULL,
  title         TEXT NOT NULL,
  kind          compliance_kind NOT NULL DEFAULT 'other',
  due_on        DATE NOT NULL,
  recurrence    recurrence NOT NULL DEFAULT 'none',
  note          TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_compliance_household ON compliance_items(household_id, due_on);
