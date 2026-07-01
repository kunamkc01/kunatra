-- Kunatra — family members. Each member is a person in the household with their
-- own income; assets and loans can be attributed to a member. Household income
-- aggregates from members (falling back to the household's own field if none).
-- Idempotent. Money in paise (BIGINT).

CREATE TABLE IF NOT EXISTS members (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id             UUID NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  name                     TEXT NOT NULL,
  monthly_income_paise     BIGINT,
  monthly_essential_paise  BIGINT,
  created_at               TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_members_household ON members(household_id);

-- Attribution: who owns each asset / whose loan it is (null = joint / household-level).
ALTER TABLE assets ADD COLUMN IF NOT EXISTS member_id UUID REFERENCES members(id) ON DELETE SET NULL;
ALTER TABLE loans  ADD COLUMN IF NOT EXISTS member_id UUID REFERENCES members(id) ON DELETE SET NULL;
