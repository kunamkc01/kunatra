// Compliance calendar — due dates for tax, renewals, AMC and inspections.
import { db, HttpError } from './pool.ts';
import { getHousehold } from './repo.ts';

const KINDS = ['property_tax', 'insurance', 'amc', 'inspection', 'renewal', 'other'] as const;
const RECUR = ['none', 'monthly', 'quarterly', 'yearly'] as const;
const INTERVAL: Record<string, string> = { monthly: '1 month', quarterly: '3 months', yearly: '1 year' };

function str(v: unknown, field: string, { required = false } = {}): string | null {
  if (v == null || v === '') { if (required) throw new HttpError(400, 'invalid_input', `${field} is required`); return null; }
  if (typeof v !== 'string') throw new HttpError(400, 'invalid_input', `${field} must be a string`);
  return v.trim();
}
function dateStr(v: unknown, field: string, { required = false } = {}): string | null {
  if (v == null || v === '') { if (required) throw new HttpError(400, 'invalid_input', `${field} is required`); return null; }
  const s = String(v);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) throw new HttpError(400, 'invalid_input', `${field} must be a date (YYYY-MM-DD)`);
  return s;
}
function oneOf<T extends string>(v: unknown, allowed: readonly T[], field: string, dflt?: T): T {
  if ((v == null || v === '') && dflt !== undefined) return dflt;
  if (!allowed.includes(v as T)) throw new HttpError(400, 'invalid_input', `${field} must be one of: ${allowed.join(', ')}`);
  return v as T;
}

const row = (r: any) => ({
  id: r.id, householdId: r.household_id, assetId: r.asset_id ?? null, assetName: r.asset_name ?? null,
  title: r.title, kind: r.kind, dueOn: r.due_on, recurrence: r.recurrence, note: r.note ?? null,
});

const SELECT = `SELECT c.*, a.name AS asset_name FROM compliance_items c LEFT JOIN assets a ON a.id = c.asset_id`;

export async function listCompliance(householdId: string) {
  await getHousehold(householdId);
  const { rows } = await db().query(`${SELECT} WHERE c.household_id = $1 ORDER BY c.due_on ASC`, [householdId]);
  return rows.map(row);
}

export async function createCompliance(householdId: string, body: any) {
  await getHousehold(householdId);
  const { rows } = await db().query(
    `INSERT INTO compliance_items (household_id, asset_id, title, kind, due_on, recurrence, note)
     VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
    [householdId, str(body.assetId, 'assetId'), str(body.title, 'title', { required: true }),
     oneOf(body.kind, KINDS, 'kind', 'other'), dateStr(body.dueOn, 'dueOn', { required: true }),
     oneOf(body.recurrence, RECUR, 'recurrence', 'none'), str(body.note, 'note')]
  );
  const { rows: full } = await db().query(`${SELECT} WHERE c.id = $1`, [rows[0].id]);
  return row(full[0]);
}

export async function updateCompliance(id: string, body: any) {
  const sets: string[] = []; const vals: any[] = [];
  const push = (c: string, v: any) => { vals.push(v); sets.push(`${c} = $${vals.length}`); };
  if ('title' in body) push('title', str(body.title, 'title', { required: true }));
  if ('assetId' in body) push('asset_id', str(body.assetId, 'assetId'));
  if ('kind' in body) push('kind', oneOf(body.kind, KINDS, 'kind'));
  if ('dueOn' in body) push('due_on', dateStr(body.dueOn, 'dueOn', { required: true }));
  if ('recurrence' in body) push('recurrence', oneOf(body.recurrence, RECUR, 'recurrence'));
  if ('note' in body) push('note', str(body.note, 'note'));
  if (sets.length === 0) { const { rows } = await db().query(`${SELECT} WHERE c.id = $1`, [id]); if (!rows.length) throw new HttpError(404, 'not_found'); return row(rows[0]); }
  vals.push(id);
  await db().query(`UPDATE compliance_items SET ${sets.join(', ')} WHERE id = $${vals.length}`, vals);
  const { rows } = await db().query(`${SELECT} WHERE c.id = $1`, [id]);
  if (!rows.length) throw new HttpError(404, 'not_found');
  return row(rows[0]);
}

/** Mark done: recurring items roll forward to the next due date; one-offs are removed. */
export async function completeCompliance(id: string) {
  const { rows } = await db().query(`SELECT recurrence FROM compliance_items WHERE id = $1`, [id]);
  if (!rows.length) throw new HttpError(404, 'not_found');
  const rec = rows[0].recurrence as string;
  if (rec === 'none') {
    await db().query(`DELETE FROM compliance_items WHERE id = $1`, [id]);
    return { completed: true, item: null };
  }
  await db().query(`UPDATE compliance_items SET due_on = due_on + $2::interval WHERE id = $1`, [id, INTERVAL[rec]]);
  const { rows: full } = await db().query(`${SELECT} WHERE c.id = $1`, [id]);
  return { completed: true, item: row(full[0]) };
}

export async function deleteCompliance(id: string) {
  const { rowCount } = await db().query(`DELETE FROM compliance_items WHERE id = $1`, [id]);
  if (rowCount === 0) throw new HttpError(404, 'not_found');
}

export async function complianceSummary(householdId: string) {
  await getHousehold(householdId);
  const { rows } = await db().query(
    `SELECT
       count(*) FILTER (WHERE due_on < current_date)::int AS overdue,
       count(*) FILTER (WHERE due_on >= current_date AND due_on <= current_date + 30)::int AS due_soon,
       count(*)::int AS total
     FROM compliance_items WHERE household_id = $1`,
    [householdId]
  );
  const next = await db().query(
    `SELECT title, due_on FROM compliance_items WHERE household_id = $1 AND due_on >= current_date ORDER BY due_on ASC LIMIT 1`,
    [householdId]
  );
  return { overdue: rows[0].overdue, dueSoon: rows[0].due_soon, total: rows[0].total, next: next.rows[0] ? { title: next.rows[0].title, dueOn: next.rows[0].due_on } : null };
}
