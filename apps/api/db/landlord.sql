-- Kunatra — Landlord Suite: document vault, rent receipts, tenant portal.
-- Idempotent.

-- Phase 1: the vault. Extend the (until now unused) documents table.
ALTER TYPE document_type ADD VALUE IF NOT EXISTS 'agreement';
ALTER TYPE document_type ADD VALUE IF NOT EXISTS 'maintenance_bill';
ALTER TYPE document_type ADD VALUE IF NOT EXISTS 'invoice';

ALTER TABLE documents ADD COLUMN IF NOT EXISTS household_id UUID REFERENCES households(id) ON DELETE CASCADE;
ALTER TABLE documents ADD COLUMN IF NOT EXISTS work_order_id UUID REFERENCES work_orders(id) ON DELETE SET NULL;
ALTER TABLE documents ADD COLUMN IF NOT EXISTS size_bytes BIGINT;
ALTER TABLE documents ADD COLUMN IF NOT EXISTS content_type TEXT;
ALTER TABLE documents ADD COLUMN IF NOT EXISTS uploaded_by TEXT;
CREATE INDEX IF NOT EXISTS idx_documents_asset ON documents(asset_id);
CREATE INDEX IF NOT EXISTS idx_documents_wo ON documents(work_order_id);
CREATE INDEX IF NOT EXISTS idx_documents_household ON documents(household_id);

-- Phase 2: receipts need to name the tenant.
ALTER TABLE assets ADD COLUMN IF NOT EXISTS tenant_name TEXT;

-- Phase 3: tenant access (magic link, revocable; one tenant per property).
CREATE TABLE IF NOT EXISTS tenants (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id  UUID NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  asset_id      UUID NOT NULL UNIQUE REFERENCES assets(id) ON DELETE CASCADE,
  name          TEXT NOT NULL,
  email         TEXT,
  phone         TEXT,
  token         TEXT NOT NULL UNIQUE,
  revoked       BOOLEAN NOT NULL DEFAULT false,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE work_orders ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants(id) ON DELETE SET NULL;
