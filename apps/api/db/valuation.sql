-- Kunatra — AI property-valuation MVP. Idempotent.
-- Extra property attributes the estimate feeds on, and the estimate itself.
-- Estimates NEVER touch the user's asset value; they live beside it.

ALTER TABLE real_estate_profiles ADD COLUMN IF NOT EXISTS property_type TEXT;  -- apartment | independent | villa | plot
ALTER TABLE real_estate_profiles ADD COLUMN IF NOT EXISTS bedrooms INT;
ALTER TABLE real_estate_profiles ADD COLUMN IF NOT EXISTS bathrooms INT;
ALTER TABLE real_estate_profiles ADD COLUMN IF NOT EXISTS floor INT;
ALTER TABLE real_estate_profiles ADD COLUMN IF NOT EXISTS built_year INT;
ALTER TABLE real_estate_profiles ADD COLUMN IF NOT EXISTS city TEXT;
ALTER TABLE real_estate_profiles ADD COLUMN IF NOT EXISTS locality TEXT;

-- One current estimate per asset (history can come later).
CREATE TABLE IF NOT EXISTS property_valuations (
  asset_id             UUID PRIMARY KEY REFERENCES assets(id) ON DELETE CASCADE,
  household_id         UUID NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  status               TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','ok','unavailable')),
  estimated_value_paise BIGINT,
  low_paise            BIGINT,
  high_paise           BIGINT,
  price_per_sqft_paise BIGINT,
  estimated_rent_paise BIGINT,
  rental_yield_pct     NUMERIC(6,2),
  annual_growth_pct    NUMERIC(6,2),
  confidence           TEXT CHECK (confidence IN ('low','medium','high')),
  summary              TEXT,
  reasons              JSONB,
  provider             TEXT,
  prompt_version       TEXT,
  feedback             TEXT CHECK (feedback IN ('too_low','accurate','too_high')),
  user_value_paise     BIGINT,          -- optional "what I think it's worth" from feedback
  generated_at         TIMESTAMPTZ,
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_valuation_household ON property_valuations(household_id);
CREATE INDEX IF NOT EXISTS idx_valuation_refresh ON property_valuations(status, generated_at);
