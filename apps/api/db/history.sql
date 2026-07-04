-- Kunatra — net-worth history: one snapshot per household per month, written by
-- the daily sweep. The current month's row is upserted on every sweep (a live
-- point); past months freeze automatically when the month rolls over. Idempotent.

CREATE TABLE IF NOT EXISTS networth_snapshots (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id       UUID NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  month              DATE NOT NULL,              -- first day of the month
  net_worth_paise    BIGINT NOT NULL,
  gross_assets_paise BIGINT NOT NULL,
  total_debt_paise   BIGINT NOT NULL,
  liquid_paise       BIGINT NOT NULL DEFAULT 0,
  by_member          JSONB,                      -- { memberId: netWorthPaise }
  by_class           JSONB,                      -- { assetClass: valuePaise }
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (household_id, month)
);
CREATE INDEX IF NOT EXISTS idx_networth_household ON networth_snapshots(household_id, month);
