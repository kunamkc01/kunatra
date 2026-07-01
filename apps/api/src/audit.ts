// Audit trail — every create/update/delete records who did it and when.
import type { Request, Response, NextFunction } from 'express';
import { pool, db } from './pool.ts';

const SINGULAR: Record<string, string> = {
  assets: 'asset', loans: 'loan', members: 'member', vendors: 'vendor',
  'work-orders': 'work order', inspections: 'inspection', valuations: 'valuation',
  contributions: 'contribution', users: 'teammate', households: 'household', compliance: 'compliance item',
};

export async function recordAudit(entry: {
  householdId: string; actorEmail?: string; actorRole?: string;
  action: string; entityType: string; entityId?: string | null; label?: string | null;
}) {
  if (!pool) return;
  await pool.query(
    `INSERT INTO audit_log (household_id, actor_email, actor_role, action, entity_type, entity_id, label)
     VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    [entry.householdId, entry.actorEmail ?? null, entry.actorRole ?? null, entry.action, entry.entityType, entry.entityId ?? null, entry.label ?? null]
  );
}

export async function listAudit(householdId: string, limit = 100) {
  const { rows } = await db().query(
    `SELECT * FROM audit_log WHERE household_id = $1 ORDER BY created_at DESC LIMIT $2`, [householdId, limit]);
  return rows.map((r) => ({
    id: r.id, actorEmail: r.actor_email, actorRole: r.actor_role,
    action: r.action, entityType: r.entity_type, entityId: r.entity_id, label: r.label, createdAt: r.created_at,
  }));
}

/** Classify a mutation from its method + path (+ response body for created ids/labels). */
function classify(req: Request, body: any): { action: string; entityType: string; entityId: string | null; label: string | null } | null {
  const action = req.method === 'POST' ? 'created' : req.method === 'PATCH' ? 'updated' : 'deleted';
  const segs = req.path.replace(/^\/api\//, '').split('/');
  let key: string | undefined;
  let entityId: string | null = null;

  if (segs[0] === 'households' && segs.length === 2) { key = 'households'; entityId = segs[1]; }
  else if (segs.length >= 3) { key = segs[2]; entityId = req.method === 'POST' ? (body?.id ?? null) : segs[1]; }
  else if (segs.length === 2) { key = segs[0]; entityId = req.method === 'POST' ? (body?.id ?? null) : segs[1]; }
  if (!key || key === 'complete' || key === 'schedule') return null; // skip sub-action POSTs

  const entityType = SINGULAR[key] ?? key;
  const label = body?.name ?? body?.title ?? body?.displayName ?? null;
  return { action, entityType, entityId, label };
}

/** After any successful mutation under /api (except auth), write an audit row. */
export function auditMiddleware(req: Request, res: Response, next: NextFunction) {
  if (!['POST', 'PATCH', 'DELETE'].includes(req.method)) return next();
  if (!req.path.startsWith('/api/') || req.path.startsWith('/api/auth')) return next();

  let captured: any;
  const origJson = res.json.bind(res);
  res.json = (b: any) => { captured = b; return origJson(b); };

  res.on('finish', () => {
    if (res.statusCode < 200 || res.statusCode >= 300 || !req.user) return;
    const info = classify(req, captured);
    if (!info) return;
    recordAudit({
      householdId: req.user.householdId, actorEmail: req.user.email, actorRole: req.user.role, ...info,
    }).catch(() => { /* never break a request because of audit */ });
  });

  next();
}
