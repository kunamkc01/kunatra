-- Kunatra — AI estimate history: every successful valuation appends a dated
-- point (the main table keeps only the CURRENT estimate). Over refreshes this
-- becomes the estimate trendline. Backfills today's estimates as first points.
-- Idempotent.

CREATE TABLE IF NOT EXISTS valuation_history (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  asset_id              UUID NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
  household_id          UUID NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  generated_at          TIMESTAMPTZ NOT NULL,
  estimated_value_paise BIGINT NOT NULL,
  low_paise             BIGINT,
  high_paise            BIGINT,
  estimated_rent_paise  BIGINT,
  confidence            TEXT,
  provider              TEXT,
  prompt_version        TEXT
);
CREATE INDEX IF NOT EXISTS idx_valhist_asset ON valuation_history(asset_id, generated_at);

-- First points: the estimates that already exist.
INSERT INTO valuation_history (asset_id, household_id, generated_at, estimated_value_paise, low_paise, high_paise, estimated_rent_paise, confidence, provider, prompt_version)
SELECT pv.asset_id, pv.household_id, pv.generated_at, pv.estimated_value_paise, pv.low_paise, pv.high_paise, pv.estimated_rent_paise, pv.confidence, pv.provider, pv.prompt_version
  FROM property_valuations pv
 WHERE pv.status = 'ok' AND pv.estimated_value_paise IS NOT NULL
   AND NOT EXISTS (SELECT 1 FROM valuation_history vh WHERE vh.asset_id = pv.asset_id AND vh.generated_at = pv.generated_at);
