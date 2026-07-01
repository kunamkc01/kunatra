-- Kunatra — tenancy / rent. Monthly rent on a let property drives DSCR
-- (rent ÷ EMI). Idempotent. Money in paise.

ALTER TABLE assets ADD COLUMN IF NOT EXISTS monthly_rent_paise BIGINT;
