-- Kunatra — memberships: one login can access several households, with a role in
-- each (and, for a 'member', a link to their own person). Idempotent.

-- Widen the user-role check (users.role becomes the "home" role; membership.role is authoritative).
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check;
ALTER TABLE users ADD CONSTRAINT users_role_check CHECK (role IN ('owner','operations','advisor','manager','member'));

CREATE TABLE IF NOT EXISTS memberships (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  household_id  UUID NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  role          TEXT NOT NULL CHECK (role IN ('owner','manager','member','operations','advisor')),
  member_id     UUID REFERENCES members(id) ON DELETE SET NULL,  -- for role='member': which person
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, household_id)
);
CREATE INDEX IF NOT EXISTS idx_memberships_user ON memberships(user_id);
CREATE INDEX IF NOT EXISTS idx_memberships_household ON memberships(household_id);

-- Backfill a membership for every existing user from their current household + role.
INSERT INTO memberships (user_id, household_id, role)
  SELECT id, household_id, role FROM users
  ON CONFLICT (user_id, household_id) DO NOTHING;
