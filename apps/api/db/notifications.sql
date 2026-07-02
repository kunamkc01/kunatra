-- Kunatra — contact + notification support. Idempotent.

-- A phone number on the login (for SMS notifications).
ALTER TABLE users ADD COLUMN IF NOT EXISTS phone TEXT;

-- Guards the daily compliance-reminder sweep so we don't re-notify the same day.
ALTER TABLE compliance_items ADD COLUMN IF NOT EXISTS reminded_on DATE;
