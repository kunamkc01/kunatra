-- Kunatra — profile avatars and recurring operations. Idempotent.
-- (The `recurrence` enum already exists from compliance.sql.)

ALTER TABLE users       ADD COLUMN IF NOT EXISTS avatar TEXT;                                  -- small image, data URL
ALTER TABLE work_orders ADD COLUMN IF NOT EXISTS recurrence recurrence NOT NULL DEFAULT 'none';
ALTER TABLE inspections ADD COLUMN IF NOT EXISTS recurrence recurrence NOT NULL DEFAULT 'none';
