-- Kunatra — link a mutual fund / SIP asset to its AMFI scheme so its current
-- value is computed from units × latest NAV (units derived from the dated
-- contributions). Idempotent.

ALTER TABLE assets ADD COLUMN IF NOT EXISTS fund_scheme_code TEXT;
ALTER TABLE assets ADD COLUMN IF NOT EXISTS fund_scheme_name TEXT;
ALTER TABLE assets ADD COLUMN IF NOT EXISTS fund_valued_at  TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_assets_fund ON assets(fund_scheme_code) WHERE fund_scheme_code IS NOT NULL;
