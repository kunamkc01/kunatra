-- Kunatra — personal loans given (lent out) and taken (borrowed), with periodic
-- interest. Given adds to assets, taken to liabilities (folded into net worth via
-- loadPosition). Interest is auto-computed from rate + frequency; actual receipts
-- and payments can also be logged. Idempotent.

DO $$ BEGIN
  CREATE TYPE loan_direction AS ENUM ('given','taken');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE interest_frequency AS ENUM ('monthly','quarterly','half_yearly','yearly');
EXCEPTION WHEN duplicate_object THEN null; END $$;

CREATE TABLE IF NOT EXISTS personal_loans (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id    UUID NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  direction       loan_direction NOT NULL,          -- given = we lent; taken = we borrowed
  counterparty    TEXT NOT NULL,                     -- the other party (person / entity)
  principal_paise BIGINT NOT NULL,                   -- outstanding principal
  rate_pct        NUMERIC(6,3),                      -- annual interest rate
  frequency       interest_frequency NOT NULL DEFAULT 'monthly',  -- how often interest is paid
  started_on      DATE,
  member_id       UUID REFERENCES members(id) ON DELETE SET NULL,
  note            TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_personal_loans_household ON personal_loans(household_id, direction);

-- Actual interest received / paid (and any principal movements) — the ledger.
CREATE TABLE IF NOT EXISTS personal_loan_payments (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  loan_id       UUID NOT NULL REFERENCES personal_loans(id) ON DELETE CASCADE,
  household_id  UUID NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  paid_on       DATE NOT NULL,
  amount_paise  BIGINT NOT NULL,
  kind          TEXT NOT NULL DEFAULT 'interest',    -- 'interest' | 'principal'
  note          TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_pl_payments_loan ON personal_loan_payments(loan_id, paid_on DESC);
