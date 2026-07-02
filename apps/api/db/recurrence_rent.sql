-- Kunatra — schedule-based recurrence + the rent roll. Idempotent.

-- Recurrence gets a MODE: 'on_completion' (spawn the next when this one closes,
-- the original behavior) or 'fixed' (calendar-driven — each period is generated
-- on schedule regardless of whether the prior one is done). series_id groups the
-- occurrences of one recurring task so the sweep can generate without duplicating.
ALTER TABLE work_orders ADD COLUMN IF NOT EXISTS recurrence_mode TEXT NOT NULL DEFAULT 'on_completion';
ALTER TABLE work_orders DROP CONSTRAINT IF EXISTS work_orders_recurrence_mode_check;
ALTER TABLE work_orders ADD CONSTRAINT work_orders_recurrence_mode_check CHECK (recurrence_mode IN ('on_completion','fixed'));
ALTER TABLE work_orders ADD COLUMN IF NOT EXISTS series_id UUID;
-- Existing recurring work orders become the head of their own series.
UPDATE work_orders SET series_id = id WHERE recurrence <> 'none' AND series_id IS NULL;

-- Rent roll — one row per rented property per month, generated on the calendar.
DO $$ BEGIN
  CREATE TYPE rent_status AS ENUM ('due','collected','waived');
EXCEPTION WHEN duplicate_object THEN null; END $$;

CREATE TABLE IF NOT EXISTS rent_collections (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id     UUID NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  asset_id         UUID NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
  period_month     DATE NOT NULL,                 -- first day of the month it's for
  amount_due_paise BIGINT NOT NULL,               -- gross rent expected that month
  tds_paise        BIGINT NOT NULL DEFAULT 0,
  status           rent_status NOT NULL DEFAULT 'due',
  collected_on     DATE,
  collected_paise  BIGINT,
  note             TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (asset_id, period_month)
);
CREATE INDEX IF NOT EXISTS idx_rent_household ON rent_collections(household_id, period_month DESC);
