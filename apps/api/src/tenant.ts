// Tenant portal — deliberately OUTSIDE the household RBAC. A tenant gets a
// revocable magic link scoped to ONE property: raise maintenance requests,
// track them, download their rent receipts and agreement. They can never see
// the household, its members, values, or any other property.
import crypto from 'node:crypto';
import type { Request, Response, NextFunction } from 'express';
import { db, paiseToRupees, HttpError } from './pool.ts';
import { sendEmail, notifyMoneyManagers, appUrl } from './notify.ts';
import { rentReceipt, type ReceiptData } from './rent.ts';
import { getDocumentFile } from './documents.ts';

export interface TenantContext { id: string; assetId: string; householdId: string; name: string; }
declare global {
  namespace Express { interface Request { tenant?: TenantContext; } }
}

// ---- owner side --------------------------------------------------------------

const tenantRow = (r: any) => ({
  id: r.id, assetId: r.asset_id, name: r.name, email: r.email ?? null, phone: r.phone ?? null,
  revoked: r.revoked, createdAt: r.created_at,
  link: `${appUrl}/tenant/?t=${r.token}`,
});

/** Invite (or replace) the tenant on a property; issues a fresh magic link. */
export async function setTenant(assetId: string, body: any) {
  const a = await db().query(`SELECT household_id, name FROM assets WHERE id = $1`, [assetId]);
  if (!a.rows[0]) throw new HttpError(404, 'asset_not_found');
  const name = typeof body.name === 'string' && body.name.trim() ? body.name.trim() : null;
  if (!name) throw new HttpError(400, 'invalid_input', 'Tenant name is required');
  const email = typeof body.email === 'string' && body.email.trim() ? body.email.trim().toLowerCase() : null;
  const phone = typeof body.phone === 'string' && body.phone.trim() ? body.phone.trim() : null;
  const token = crypto.randomBytes(24).toString('hex');

  const { rows } = await db().query(
    `INSERT INTO tenants (household_id, asset_id, name, email, phone, token, revoked)
     VALUES ($1,$2,$3,$4,$5,$6,false)
     ON CONFLICT (asset_id) DO UPDATE SET
       name = EXCLUDED.name, email = EXCLUDED.email, phone = EXCLUDED.phone,
       token = EXCLUDED.token, revoked = false
     RETURNING *`,
    [a.rows[0].household_id, assetId, name, email, phone, token]
  );
  const t = tenantRow(rows[0]);
  if (email) {
    void sendEmail(email, `Your tenant portal for ${a.rows[0].name}`,
      `Hi ${name},\n\nYour landlord uses Kunatra to manage ${a.rows[0].name}. Through your private link you can ` +
      `raise maintenance requests, track their status, and download your rent receipts:\n\n${t.link}\n\n` +
      `Keep this link private — it is your access.`);
  }
  return t;
}

export async function getTenant(assetId: string) {
  const { rows } = await db().query(`SELECT * FROM tenants WHERE asset_id = $1`, [assetId]);
  return rows[0] ? tenantRow(rows[0]) : null;
}

/** Revoke the magic link (keeps the record + request attribution). */
export async function revokeTenant(assetId: string) {
  const { rowCount } = await db().query(`UPDATE tenants SET revoked = true WHERE asset_id = $1`, [assetId]);
  if (!rowCount) throw new HttpError(404, 'tenant_not_found');
  return { ok: true };
}

// ---- tenant-side auth (magic token, rate-limited) ------------------------------

const hits = new Map<string, { n: number; reset: number }>();
const LIMIT = 120, WINDOW_MS = 15 * 60 * 1000;

export async function tenantAuth(req: Request, _res: Response, next: NextFunction) {
  try {
    const token = (typeof req.query.t === 'string' && req.query.t)
      || (typeof req.headers['x-tenant-token'] === 'string' && req.headers['x-tenant-token'] as string) || '';
    if (!token || token.length < 20) throw new HttpError(401, 'unauthenticated', 'This link is not valid');
    const now = Date.now();
    const h = hits.get(token);
    if (h && h.reset > now && h.n >= LIMIT) throw new HttpError(429, 'slow_down', 'Too many requests — try again shortly');
    hits.set(token, h && h.reset > now ? { n: h.n + 1, reset: h.reset } : { n: 1, reset: now + WINDOW_MS });

    const { rows } = await db().query(`SELECT * FROM tenants WHERE token = $1 AND NOT revoked`, [token]);
    if (!rows[0]) throw new HttpError(401, 'unauthenticated', 'This link is no longer valid — ask your landlord for a new one');
    req.tenant = { id: rows[0].id, assetId: rows[0].asset_id, householdId: rows[0].household_id, name: rows[0].name };
    next();
  } catch (e) { next(e); }
}

// ---- what a tenant can do -------------------------------------------------------

/** Their property, nothing else — name, address, their rent. */
export async function tenantMe(t: TenantContext) {
  const { rows } = await db().query(
    `SELECT a.name, a.monthly_rent_paise, p.address, p.city, p.locality
       FROM assets a LEFT JOIN real_estate_profiles p ON p.asset_id = a.id WHERE a.id = $1`, [t.assetId]);
  const r = rows[0];
  return {
    tenantName: t.name,
    property: { name: r.name, address: r.address ?? null, city: r.city ?? null, locality: r.locality ?? null },
    monthlyRent: r.monthly_rent_paise != null ? paiseToRupees(r.monthly_rent_paise) : null,
  };
}

export async function tenantRequests(t: TenantContext) {
  const { rows } = await db().query(
    `SELECT id, title, status, notes, scheduled_for, created_at, updated_at
       FROM work_orders WHERE tenant_id = $1 ORDER BY created_at DESC`, [t.id]);
  return rows.map((r) => ({
    id: r.id, title: r.title, status: r.status, notes: r.notes ?? null,
    scheduledFor: r.scheduled_for ?? null, createdAt: r.created_at, updatedAt: r.updated_at,
  }));
}

/** Raise a maintenance request → an open work order tagged to the tenant. */
export async function raiseRequest(t: TenantContext, body: any) {
  const title = typeof body.title === 'string' && body.title.trim();
  if (!title) throw new HttpError(400, 'invalid_input', 'Tell us what needs fixing');
  const notes = typeof body.notes === 'string' ? body.notes.trim().slice(0, 1000) : null;
  const { rows } = await db().query(
    `INSERT INTO work_orders (household_id, asset_id, title, category, status, notes, tenant_id)
     VALUES ($1,$2,$3,'repair','open',$4,$5) RETURNING id, title, status, created_at`,
    [t.householdId, t.assetId, title.slice(0, 200), notes, t.id]
  );
  const prop = await db().query(`SELECT name FROM assets WHERE id = $1`, [t.assetId]);
  void notifyMoneyManagers(t.householdId,
    `Tenant request: ${title}`,
    `${t.name} (tenant at ${prop.rows[0]?.name ?? 'your property'}) raised a maintenance request:\n\n` +
    `${title}${notes ? `\n\n"${notes}"` : ''}\n\nSee it under Operations → Work orders: ${appUrl}/operations`,
    `Kunatra: tenant request at ${prop.rows[0]?.name ?? 'property'} — ${title}`);
  return { id: rows[0].id, title: rows[0].title, status: rows[0].status, createdAt: rows[0].created_at };
}

/** Collected rent for their property (receipt list). */
export async function tenantReceipts(t: TenantContext) {
  const { rows } = await db().query(
    `SELECT id, period_month, amount_due_paise, tds_paise, collected_on, collected_paise
       FROM rent_collections WHERE asset_id = $1 AND status = 'collected' ORDER BY period_month DESC`, [t.assetId]);
  return rows.map((r) => ({
    id: r.id, periodMonth: r.period_month,
    amount: r.collected_paise != null ? paiseToRupees(r.collected_paise) : paiseToRupees(r.amount_due_paise) - paiseToRupees(r.tds_paise),
    collectedOn: r.collected_on ?? null,
  }));
}

export async function tenantReceipt(t: TenantContext, rentId: string): Promise<ReceiptData> {
  const d = await rentReceipt(rentId);
  if (d.assetId !== t.assetId || d.status !== 'collected') throw new HttpError(404, 'rent_not_found');
  return d;
}

/** Their agreement documents only. */
export async function tenantDocuments(t: TenantContext) {
  const { rows } = await db().query(
    `SELECT id, filename, size_bytes, uploaded_at FROM documents
      WHERE asset_id = $1 AND document_type = 'agreement' ORDER BY uploaded_at DESC`, [t.assetId]);
  return rows.map((r) => ({ id: r.id, filename: r.filename, size: r.size_bytes != null ? Number(r.size_bytes) : null, uploadedAt: r.uploaded_at }));
}

export async function tenantDocumentFile(t: TenantContext, docId: string) {
  const { rows } = await db().query(
    `SELECT 1 FROM documents WHERE id = $1 AND asset_id = $2 AND document_type = 'agreement'`, [docId, t.assetId]);
  if (!rows[0]) throw new HttpError(404, 'document_not_found');
  return getDocumentFile(docId);
}
