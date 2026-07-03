-- Kunatra — income belongs to people, not the household. For any household still
-- carrying a take-home figure with no earning member, move that figure onto the
-- owner's person (creating + linking one from the owner's name if needed), then
-- clear the household field. Idempotent: once moved, the WHERE no longer matches.

DO $$
DECLARE
  h RECORD;
  o RECORD;
  mid UUID;
BEGIN
  FOR h IN
    SELECT hh.id, hh.monthly_take_home_paise
      FROM households hh
     WHERE hh.monthly_take_home_paise IS NOT NULL
       AND NOT EXISTS (
         SELECT 1 FROM members m
          WHERE m.household_id = hh.id AND m.monthly_gross_paise IS NOT NULL)
  LOOP
    SELECT u.id AS user_id, u.full_name, u.email, ms.id AS membership_id, ms.member_id
      INTO o
      FROM memberships ms JOIN users u ON u.id = ms.user_id
     WHERE ms.household_id = h.id AND ms.role = 'owner'
     ORDER BY ms.created_at
     LIMIT 1;

    IF o.user_id IS NULL THEN CONTINUE; END IF;  -- ownerless household: leave as-is

    IF o.member_id IS NOT NULL THEN
      UPDATE members SET monthly_gross_paise = h.monthly_take_home_paise
       WHERE id = o.member_id AND monthly_gross_paise IS NULL;
    ELSE
      INSERT INTO members (household_id, name, monthly_gross_paise)
      VALUES (h.id, COALESCE(NULLIF(o.full_name, ''), split_part(o.email, '@', 1)), h.monthly_take_home_paise)
      RETURNING id INTO mid;
      UPDATE memberships SET member_id = mid WHERE id = o.membership_id;
    END IF;

    UPDATE households SET monthly_take_home_paise = NULL WHERE id = h.id;
  END LOOP;
END $$;

-- Where members already record income, the engine ignores the household figure
-- anyway (member sum wins) — clear the stale field so nothing misleads.
UPDATE households hh SET monthly_take_home_paise = NULL
 WHERE hh.monthly_take_home_paise IS NOT NULL
   AND EXISTS (SELECT 1 FROM members m WHERE m.household_id = hh.id AND m.monthly_gross_paise IS NOT NULL);

-- Every OWNER login is a person in their own household. Backfill the missing
-- links: attach to an existing member matching their name (or 'Self'), else
-- create one from their name. Managers/advisors/operations are not household
-- people, so they're untouched. Idempotent via the member_id IS NULL guard.
DO $$
DECLARE
  ms RECORD;
  mid UUID;
BEGIN
  FOR ms IN
    SELECT m.id AS membership_id, m.household_id, u.full_name, u.email
      FROM memberships m JOIN users u ON u.id = m.user_id
     WHERE m.role = 'owner' AND m.member_id IS NULL
  LOOP
    SELECT id INTO mid FROM members
     WHERE household_id = ms.household_id
       AND (name = COALESCE(NULLIF(ms.full_name, ''), '') OR name = 'Self')
       AND NOT EXISTS (SELECT 1 FROM memberships x WHERE x.member_id = members.id)
     ORDER BY (name = 'Self') LIMIT 1;
    IF mid IS NULL THEN
      INSERT INTO members (household_id, name)
      VALUES (ms.household_id, COALESCE(NULLIF(ms.full_name, ''), split_part(ms.email, '@', 1)))
      RETURNING id INTO mid;
    END IF;
    UPDATE memberships SET member_id = mid WHERE id = ms.membership_id;
    mid := NULL;
  END LOOP;
END $$;
