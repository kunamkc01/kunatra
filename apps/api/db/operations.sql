-- Kunatra — Asset Operations Management (Tier 2, narrowed).
-- Work orders, vendors and inspections over the existing asset model.
-- Idempotent: safe to run on an existing database. Money in paise (BIGINT).

DO $$ BEGIN
  CREATE TYPE work_order_status AS ENUM ('open','in_progress','done','cancelled');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE work_order_category AS ENUM ('repair','maintenance','amc','improvement','other');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE inspection_rating AS ENUM ('good','fair','poor');
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- Service providers the household works with.
CREATE TABLE IF NOT EXISTS vendors (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id  UUID NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  name          TEXT NOT NULL,
  category      TEXT,               -- e.g. plumber, electrician, AMC
  phone         TEXT,
  notes         TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_vendors_household ON vendors(household_id);

-- Maintenance/repair tasks against an asset, with a lifecycle and a cost-at-closure gate.
CREATE TABLE IF NOT EXISTS work_orders (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id         UUID NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  asset_id             UUID REFERENCES assets(id) ON DELETE SET NULL,   -- keep history if the asset is removed
  vendor_id            UUID REFERENCES vendors(id) ON DELETE SET NULL,
  title                TEXT NOT NULL,
  category             work_order_category NOT NULL DEFAULT 'repair',
  status               work_order_status   NOT NULL DEFAULT 'open',
  scheduled_for        DATE,
  estimated_cost_paise BIGINT,
  actual_cost_paise    BIGINT,        -- required to close (the closure gate)
  notes                TEXT,
  closure_note         TEXT,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_work_orders_household ON work_orders(household_id);
CREATE INDEX IF NOT EXISTS idx_work_orders_asset ON work_orders(asset_id);

-- Scheduled condition checks so decline is visible early.
CREATE TABLE IF NOT EXISTS inspections (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id  UUID NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  asset_id      UUID REFERENCES assets(id) ON DELETE SET NULL,
  inspected_on  DATE NOT NULL,
  rating        inspection_rating NOT NULL,
  notes         TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_inspections_household ON inspections(household_id);
CREATE INDEX IF NOT EXISTS idx_inspections_asset ON inspections(asset_id);
