-- Kunatra — asset photos: one or more pictures per asset, stored as small
-- (downscaled) data URLs. Household is denormalised for straightforward scoping.
-- Idempotent.

CREATE TABLE IF NOT EXISTS asset_photos (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  asset_id      UUID NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
  household_id  UUID NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  data_url      TEXT NOT NULL,
  caption       TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_asset_photos_asset ON asset_photos(asset_id);
