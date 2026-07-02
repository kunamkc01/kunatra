-- Kunatra — model income as gross → TDS → net, for salary (members) and rent (assets).
-- Net (what actually lands) is what the engine uses. Idempotent.

-- Member salary: gross + TDS. Net = gross − TDS.
ALTER TABLE members ADD COLUMN IF NOT EXISTS monthly_gross_paise BIGINT;
ALTER TABLE members ADD COLUMN IF NOT EXISTS monthly_tds_paise   BIGINT;
-- Backfill: treat any previously-entered income as gross (TDS 0).
UPDATE members SET monthly_gross_paise = monthly_income_paise
  WHERE monthly_gross_paise IS NULL AND monthly_income_paise IS NOT NULL;

-- Rent: existing monthly_rent_paise is the gross rent; add TDS withheld on it.
ALTER TABLE assets ADD COLUMN IF NOT EXISTS monthly_rent_tds_paise BIGINT;
