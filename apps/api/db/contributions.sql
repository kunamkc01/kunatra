-- Kunatra — dated contribution ledger (drives XIRR / money-weighted return).
-- amount_paise > 0 = money invested; < 0 = money withdrawn. Idempotent.

CREATE TABLE IF NOT EXISTS contributions (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  asset_id       UUID NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
  amount_paise   BIGINT NOT NULL,          -- >0 invested, <0 withdrawn
  contributed_on DATE NOT NULL,
  note           TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_contributions_asset ON contributions(asset_id, contributed_on);
