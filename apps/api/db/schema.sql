-- ATLAS — core schema (Phase 0 / Tier 1)
-- PostgreSQL. Money stored in paise (BIGINT) to avoid float drift; the API/engine work in rupees.
-- Sensitive identifiers (Aadhaar, PAN) are stored ENCRYPTED at the application layer
-- with only the last four digits in clear for display. Never store them in plaintext.

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- A household / app account (the unit a single user manages).
CREATE TABLE households (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  display_name  TEXT NOT NULL,
  -- strain & runway inputs
  monthly_take_home_paise   BIGINT,
  monthly_essential_paise   BIGINT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- People who own assets. Identity lives here, stored once, referenced from ownership.
CREATE TABLE owners (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id  UUID NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  full_name     TEXT NOT NULL,
  contact       TEXT,
  -- SENSITIVE: ciphertext only; last4 for display. Application encrypts before insert.
  aadhaar_enc   BYTEA,
  aadhaar_last4 CHAR(4),
  pan_enc       BYTEA,
  pan_last4     CHAR(4),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TYPE asset_class AS ENUM (
  'real_estate','mutual_fund','sip','equity','epf','ppf','cash','gold','insurance','other'
);

CREATE TABLE assets (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id  UUID NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  name          TEXT NOT NULL,
  asset_class   asset_class NOT NULL,
  current_value_paise BIGINT NOT NULL DEFAULT 0,
  liquid        BOOLEAN NOT NULL DEFAULT false,
  -- parent for component assets (lift/solar/UPS under a property)
  parent_asset_id UUID REFERENCES assets(id) ON DELETE CASCADE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_assets_household ON assets(household_id);

-- Owner x Asset, with share and roles.
CREATE TABLE asset_ownership (
  asset_id      UUID NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
  owner_id      UUID NOT NULL REFERENCES owners(id) ON DELETE CASCADE,
  share_pct     NUMERIC(5,2) NOT NULL DEFAULT 100.00,
  is_managing   BOOLEAN NOT NULL DEFAULT false,
  PRIMARY KEY (asset_id, owner_id)
);

-- Real-estate-specific profile (1:1 with a real_estate asset).
CREATE TABLE real_estate_profiles (
  asset_id        UUID PRIMARY KEY REFERENCES assets(id) ON DELETE CASCADE,
  address         TEXT,
  sqft            NUMERIC(10,2),
  undivided_share TEXT,          -- the unit's share of land
  ptin            TEXT,          -- property tax identification number
  car_park        TEXT,
  car_park_size   TEXT
);

CREATE TYPE utility_type AS ENUM ('electricity','water','gas','other');

CREATE TABLE utility_connections (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  asset_id        UUID NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
  utility_type    utility_type NOT NULL,
  connection_no   TEXT,          -- meter number
  service_no      TEXT,          -- unique service number (USN)
  status          TEXT,          -- water status / active / metered etc.
  provider        TEXT
);

-- Debt, secured against an asset (drives equity and LTV).
CREATE TABLE loans (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id    UUID NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  name            TEXT NOT NULL,
  outstanding_paise BIGINT NOT NULL DEFAULT 0,
  emi_monthly_paise BIGINT NOT NULL DEFAULT 0,
  rate_pct        NUMERIC(5,2),
  secured_asset_id UUID REFERENCES assets(id) ON DELETE SET NULL
);

-- Point-in-time valuations (latest drives current_value).
CREATE TABLE valuations (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  asset_id    UUID NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
  value_paise BIGINT NOT NULL,
  as_of       DATE NOT NULL,
  source      TEXT
);

-- Property tax as dated payments (e.g. "2025 June Tax").
CREATE TABLE tax_records (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  asset_id    UUID NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
  period      TEXT NOT NULL,     -- e.g. '2025-06' or 'FY2024-25'
  amount_paise BIGINT NOT NULL,
  paid_on     DATE,
  receipt_document_id UUID
);

CREATE TYPE document_type AS ENUM (
  'sale_deed','title_deed','encumbrance_certificate','allotment_letter',
  'occupancy_certificate','tax_receipt','insurance','loan_schedule','photo','other'
);

CREATE TABLE documents (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  asset_id      UUID REFERENCES assets(id) ON DELETE CASCADE,
  document_type document_type NOT NULL,
  filename      TEXT NOT NULL,
  storage_key   TEXT NOT NULL,  -- object-store key; files are not stored in the DB
  uploaded_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE tax_records
  ADD CONSTRAINT fk_tax_receipt FOREIGN KEY (receipt_document_id) REFERENCES documents(id) ON DELETE SET NULL;
