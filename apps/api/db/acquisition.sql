-- Kunatra — acquisition story on an asset: how you got it and when.
-- The acquisition price/year map onto cost basis + a dated contribution (XIRR).
-- Idempotent.

ALTER TABLE assets ADD COLUMN IF NOT EXISTS acquired_how  TEXT;     -- bought / inherited / gifted / built / other
ALTER TABLE assets ADD COLUMN IF NOT EXISTS acquired_year INTEGER;
