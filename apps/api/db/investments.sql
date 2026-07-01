-- Kunatra — appreciation & recurring investing.
-- Adds cost basis + recurring contribution to assets, and more investment classes.
-- Point-in-time valuations already live in the `valuations` table (schema.sql);
-- this wires them in via the API (latest valuation drives current value).
-- Idempotent. Money in paise (BIGINT).

ALTER TABLE assets ADD COLUMN IF NOT EXISTS cost_basis_paise BIGINT;
ALTER TABLE assets ADD COLUMN IF NOT EXISTS monthly_contribution_paise BIGINT;

-- More forms of investment (SIP/mutual_fund/equity/epf/ppf already exist).
ALTER TYPE asset_class ADD VALUE IF NOT EXISTS 'nps';
ALTER TYPE asset_class ADD VALUE IF NOT EXISTS 'fd';
ALTER TYPE asset_class ADD VALUE IF NOT EXISTS 'rd';
ALTER TYPE asset_class ADD VALUE IF NOT EXISTS 'bonds';

CREATE INDEX IF NOT EXISTS idx_valuations_asset ON valuations(asset_id, as_of DESC);
