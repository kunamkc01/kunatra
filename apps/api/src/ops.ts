// Asset Operations Management — vendors, work orders (with a lifecycle + cost-at-closure
// gate) and inspections. Money crosses the boundary in rupees; the DB stores paise.
import { db, rupeesToPaise, paiseToRupees, HttpError } from './pool.ts';
import { getHousehold } from './repo.ts';

// ---- validation helpers ---------------------------------------------------

function str(v: unknown, field: string, { required = false } = {}): string | undefined {
  if (v == null || v === '') {
    if (required) throw new HttpError(400, 'invalid_input', `${field} is required`);
    return undefined;
  }
  if (typeof v !== 'string') throw new HttpError(400, 'invalid_input', `${field} must be a string`);
  return v.trim();
}

function money(v: unknown, field: string): number | null {
  if (v == null || v === '') return null;
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0) throw new HttpError(400, 'invalid_input', `${field} must be a non-negative number`);
  return n;
}

function dateStr(v: unknown, field: string, { required = false } = {}): string | null {
  if (v == null || v === '') {
    if (required) throw new HttpError(400, 'invalid_input', `${field} is required`);
    return null;
  }
  const s = String(v);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) throw new HttpError(400, 'invalid_input', `${field} must be a date (YYYY-MM-DD)`);
  return s;
}

function oneOf<T extends string>(v: unknown, allowed: readonly T[], field: string, dflt?: T): T {
  if ((v == null || v === '') && dflt !== undefined) return dflt;
  if (!allowed.includes(v as T)) throw new HttpError(400, 'invalid_input', `${field} must be one of: ${allowed.join(', ')}`);
  return v as T;
}

const CATEGORIES = ['repair', 'maintenance', 'amc', 'improvement', 'other'] as const;
const STATUSES = ['open', 'in_progress', 'done', 'cancelled'] as const;
const RATINGS = ['good', 'fair', 'poor'] as const;
const RECUR = ['none', 'monthly', 'quarterly', 'yearly'] as const;
const RECUR_MODE = ['on_completion', 'fixed'] as const;
const INTERVAL: Record<string, string> = { monthly: '1 month', quarterly: '3 months', yearly: '1 year' };
type Status = (typeof STATUSES)[number];

// Allowed status transitions. Closing (-> done) additionally requires an actual cost.
const TRANSITIONS: Record<Status, Status[]> = {
  open: ['in_progress', 'done', 'cancelled'],
  in_progress: ['done', 'open', 'cancelled'],
  done: ['in_progress'], // reopen
  cancelled: ['open'],
};

// ---- vendors --------------------------------------------------------------

const vendorRow = (r: any) => ({
  id: r.id, householdId: r.household_id, name: r.name,
  category: r.category ?? null, phone: r.phone ?? null, notes: r.notes ?? null, createdAt: r.created_at,
});

export async function listVendors(householdId: string) {
  await getHousehold(householdId);
  const { rows } = await db().query(`SELECT * FROM vendors WHERE household_id = $1 ORDER BY name`, [householdId]);
  return rows.map(vendorRow);
}

export async function createVendor(householdId: string, body: any) {
  await getHousehold(householdId);
  const { rows } = await db().query(
    `INSERT INTO vendors (household_id, name, category, phone, notes) VALUES ($1,$2,$3,$4,$5) RETURNING *`,
    [householdId, str(body.name, 'name', { required: true }), str(body.category, 'category') ?? null,
     str(body.phone, 'phone') ?? null, str(body.notes, 'notes') ?? null]
  );
  return vendorRow(rows[0]);
}

export async function updateVendor(id: string, body: any) {
  const sets: string[] = []; const vals: any[] = [];
  const push = (c: string, v: any) => { vals.push(v); sets.push(`${c} = $${vals.length}`); };
  if ('name' in body) push('name', str(body.name, 'name', { required: true }));
  if ('category' in body) push('category', str(body.category, 'category') ?? null);
  if ('phone' in body) push('phone', str(body.phone, 'phone') ?? null);
  if ('notes' in body) push('notes', str(body.notes, 'notes') ?? null);
  if (sets.length === 0) {
    const { rows } = await db().query(`SELECT * FROM vendors WHERE id = $1`, [id]);
    if (rows.length === 0) throw new HttpError(404, 'vendor_not_found');
    return vendorRow(rows[0]);
  }
  vals.push(id);
  const { rows } = await db().query(`UPDATE vendors SET ${sets.join(', ')} WHERE id = $${vals.length} RETURNING *`, vals);
  if (rows.length === 0) throw new HttpError(404, 'vendor_not_found');
  return vendorRow(rows[0]);
}

export async function deleteVendor(id: string) {
  const { rowCount } = await db().query(`DELETE FROM vendors WHERE id = $1`, [id]);
  if (rowCount === 0) throw new HttpError(404, 'vendor_not_found');
}

// ---- work orders ----------------------------------------------------------

const woRow = (r: any) => ({
  id: r.id, householdId: r.household_id, assetId: r.asset_id ?? null, vendorId: r.vendor_id ?? null,
  assetName: r.asset_name ?? null, vendorName: r.vendor_name ?? null,
  title: r.title, category: r.category, status: r.status, recurrence: r.recurrence,
  recurrenceMode: r.recurrence_mode ?? 'on_completion', seriesId: r.series_id ?? null,
  scheduledFor: r.scheduled_for ?? null,
  estimatedCost: r.estimated_cost_paise != null ? paiseToRupees(r.estimated_cost_paise) : null,
  actualCost: r.actual_cost_paise != null ? paiseToRupees(r.actual_cost_paise) : null,
  notes: r.notes ?? null, closureNote: r.closure_note ?? null,
  createdAt: r.created_at, updatedAt: r.updated_at,
});

const WO_SELECT = `
  SELECT w.*, a.name AS asset_name, v.name AS vendor_name
    FROM work_orders w
    LEFT JOIN assets a ON a.id = w.asset_id
    LEFT JOIN vendors v ON v.id = w.vendor_id`;

export async function listWorkOrders(householdId: string) {
  await getHousehold(householdId);
  const { rows } = await db().query(
    `${WO_SELECT} WHERE w.household_id = $1
      ORDER BY array_position(ARRAY['in_progress','open','done','cancelled']::text[], w.status::text), w.updated_at DESC`,
    [householdId]
  );
  return rows.map(woRow);
}

async function getWorkOrderRaw(id: string) {
  const { rows } = await db().query(`${WO_SELECT} WHERE w.id = $1`, [id]);
  if (rows.length === 0) throw new HttpError(404, 'work_order_not_found');
  return rows[0];
}

export async function getWorkOrder(id: string) {
  return woRow(await getWorkOrderRaw(id));
}

export async function createWorkOrder(householdId: string, body: any) {
  await getHousehold(householdId);
  const estimated = money(body.estimatedCost, 'estimatedCost');
  const actual = money(body.actualCost, 'actualCost');
  const status = oneOf(body.status, STATUSES, 'status', 'open');
  if (status === 'done' && actual == null) {
    throw new HttpError(400, 'closure_requires_cost', 'Closing a work order requires an actual cost');
  }
  const recurrence = oneOf(body.recurrence, RECUR, 'recurrence', 'none');
  const recurrenceMode = oneOf(body.recurrenceMode, RECUR_MODE, 'recurrenceMode', 'on_completion');
  const { rows } = await db().query(
    `INSERT INTO work_orders
       (household_id, asset_id, vendor_id, title, category, status, scheduled_for, estimated_cost_paise, actual_cost_paise, notes, closure_note, recurrence, recurrence_mode)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING id`,
    [householdId, str(body.assetId, 'assetId') ?? null, str(body.vendorId, 'vendorId') ?? null,
     str(body.title, 'title', { required: true }),
     oneOf(body.category, CATEGORIES, 'category', 'repair'), status,
     dateStr(body.scheduledFor, 'scheduledFor'),
     estimated != null ? rupeesToPaise(estimated) : null,
     actual != null ? rupeesToPaise(actual) : null,
     str(body.notes, 'notes') ?? null, str(body.closureNote, 'closureNote') ?? null,
     recurrence, recurrenceMode]
  );
  // A recurring task heads its own series (so the sweep can group its occurrences).
  if (recurrence !== 'none') await db().query(`UPDATE work_orders SET series_id = id WHERE id = $1`, [rows[0].id]);
  return getWorkOrder(rows[0].id);
}

export async function updateWorkOrder(id: string, body: any) {
  const current = await getWorkOrderRaw(id);
  const sets: string[] = []; const vals: any[] = [];
  const push = (c: string, v: any) => { vals.push(v); sets.push(`${c} = $${vals.length}`); };

  // Status transition (validated against the state machine + closure gate).
  let closedNow = false;
  if ('status' in body && body.status !== current.status) {
    const next = oneOf(body.status, STATUSES, 'status');
    if (!TRANSITIONS[current.status as Status].includes(next)) {
      throw new HttpError(409, 'invalid_transition', `Cannot move a work order from ${current.status} to ${next}`);
    }
    if (next === 'done') {
      // The closure gate: an actual cost must be known (from the body or already stored).
      const providedActual = 'actualCost' in body ? money(body.actualCost, 'actualCost') : null;
      if (providedActual == null && current.actual_cost_paise == null) {
        throw new HttpError(400, 'closure_requires_cost', 'Closing a work order requires an actual cost');
      }
      closedNow = true;
    }
    push('status', next);
  }
  if ('recurrence' in body) push('recurrence', oneOf(body.recurrence, RECUR, 'recurrence'));
  if ('recurrenceMode' in body) push('recurrence_mode', oneOf(body.recurrenceMode, RECUR_MODE, 'recurrenceMode'));

  if ('title' in body) push('title', str(body.title, 'title', { required: true }));
  if ('category' in body) push('category', oneOf(body.category, CATEGORIES, 'category'));
  if ('assetId' in body) push('asset_id', str(body.assetId, 'assetId') ?? null);
  if ('vendorId' in body) push('vendor_id', str(body.vendorId, 'vendorId') ?? null);
  if ('scheduledFor' in body) push('scheduled_for', dateStr(body.scheduledFor, 'scheduledFor'));
  if ('estimatedCost' in body) { const m = money(body.estimatedCost, 'estimatedCost'); push('estimated_cost_paise', m != null ? rupeesToPaise(m) : null); }
  if ('actualCost' in body) { const m = money(body.actualCost, 'actualCost'); push('actual_cost_paise', m != null ? rupeesToPaise(m) : null); }
  if ('notes' in body) push('notes', str(body.notes, 'notes') ?? null);
  if ('closureNote' in body) push('closure_note', str(body.closureNote, 'closureNote') ?? null);

  if (sets.length === 0) return woRow(current);
  push('updated_at', new Date());
  vals.push(id);
  await db().query(`UPDATE work_orders SET ${sets.join(', ')} WHERE id = $${vals.length}`, vals);

  // 'on_completion' recurrence spawns the next occurrence when this one closes.
  // ('fixed' recurrence is generated on the calendar by sweepFixedWorkOrders.)
  const recurrence = (body.recurrence != null ? body.recurrence : current.recurrence) as string;
  const mode = (body.recurrenceMode != null ? body.recurrenceMode : current.recurrence_mode) as string;
  if (closedNow && recurrence !== 'none' && mode === 'on_completion') {
    await db().query(
      `INSERT INTO work_orders (household_id, asset_id, vendor_id, title, category, status, scheduled_for, estimated_cost_paise, notes, recurrence, recurrence_mode, series_id)
       SELECT household_id, asset_id, vendor_id, title, category, 'open',
              COALESCE(scheduled_for, current_date) + $2::interval, estimated_cost_paise, notes, $3::recurrence,
              recurrence_mode, COALESCE(series_id, id)
         FROM work_orders WHERE id = $1`,
      [id, INTERVAL[recurrence], recurrence]
    );
  }
  return getWorkOrder(id);
}

export async function deleteWorkOrder(id: string) {
  const { rowCount } = await db().query(`DELETE FROM work_orders WHERE id = $1`, [id]);
  if (rowCount === 0) throw new HttpError(404, 'work_order_not_found');
}

/**
 * Calendar-driven recurrence: for every 'fixed' recurring series, materialize an
 * open occurrence for each period whose scheduled date has arrived — independent
 * of whether the prior one was completed. Runs daily (and on startup).
 */
export async function sweepFixedWorkOrders(): Promise<void> {
  if (!process.env.DATABASE_URL) return;
  try {
    // The latest occurrence of each fixed series is the template we copy forward.
    const { rows: series } = await db().query(
      `SELECT DISTINCT ON (series_id)
              series_id, household_id, asset_id, vendor_id, title, category,
              estimated_cost_paise, notes, recurrence, scheduled_for
         FROM work_orders
        WHERE recurrence <> 'none' AND recurrence_mode = 'fixed'
          AND series_id IS NOT NULL AND scheduled_for IS NOT NULL
        ORDER BY series_id, scheduled_for DESC`
    );
    let made = 0;
    for (const s of series) {
      let cur = s.scheduled_for as string;
      const iv = INTERVAL[s.recurrence as string];
      // Generate every period up to today (guarded so we never loop unbounded).
      for (let i = 0; i < 240; i++) {
        const nx = await db().query(
          `SELECT ($1::date + $2::interval)::date AS d, ($1::date + $2::interval) <= current_date AS due`, [cur, iv]);
        if (!nx.rows[0].due) break;
        const next = nx.rows[0].d as string;
        await db().query(
          `INSERT INTO work_orders (household_id, asset_id, vendor_id, title, category, status, scheduled_for, estimated_cost_paise, notes, recurrence, recurrence_mode, series_id)
           VALUES ($1,$2,$3,$4,$5,'open',$6,$7,$8,$9,'fixed',$10)`,
          [s.household_id, s.asset_id, s.vendor_id, s.title, s.category, next, s.estimated_cost_paise, s.notes, s.recurrence, s.series_id]
        );
        made++; cur = next;
      }
    }
    if (made) console.log(`[recurrence] generated ${made} fixed work-order occurrence(s)`);
  } catch (e: any) {
    console.error(`[recurrence] fixed-work-order sweep failed: ${e?.message}`);
  }
}

// ---- inspections ----------------------------------------------------------

const inspectionRow = (r: any) => ({
  id: r.id, householdId: r.household_id, assetId: r.asset_id ?? null, assetName: r.asset_name ?? null,
  inspectedOn: r.inspected_on, rating: r.rating, recurrence: r.recurrence, notes: r.notes ?? null, createdAt: r.created_at,
});

export async function listInspections(householdId: string) {
  await getHousehold(householdId);
  const { rows } = await db().query(
    `SELECT i.*, a.name AS asset_name FROM inspections i LEFT JOIN assets a ON a.id = i.asset_id
      WHERE i.household_id = $1 ORDER BY i.inspected_on DESC`,
    [householdId]
  );
  return rows.map(inspectionRow);
}

export async function createInspection(householdId: string, body: any) {
  await getHousehold(householdId);
  const assetId = str(body.assetId, 'assetId') ?? null;
  const inspectedOn = dateStr(body.inspectedOn, 'inspectedOn', { required: true })!;
  const recurrence = oneOf(body.recurrence, RECUR, 'recurrence', 'none');
  const { rows } = await db().query(
    `INSERT INTO inspections (household_id, asset_id, inspected_on, rating, notes, recurrence) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
    [householdId, assetId, inspectedOn, oneOf(body.rating, RATINGS, 'rating'), str(body.notes, 'notes') ?? null, recurrence]
  );
  const { rows: full } = await db().query(
    `SELECT i.*, a.name AS asset_name FROM inspections i LEFT JOIN assets a ON a.id = i.asset_id WHERE i.id = $1`, [rows[0].id]);

  // A recurring inspection schedules the next one on the compliance calendar.
  if (recurrence !== 'none') {
    const title = `${full[0].asset_name ?? 'Asset'} inspection`;
    await db().query(
      `INSERT INTO compliance_items (household_id, asset_id, title, kind, due_on, recurrence)
       VALUES ($1,$2,$3,'inspection', $4::date + $5::interval, $6)`,
      [householdId, assetId, title, inspectedOn, INTERVAL[recurrence], recurrence]
    );
  }
  return inspectionRow(full[0]);
}

export async function deleteInspection(id: string) {
  const { rowCount } = await db().query(`DELETE FROM inspections WHERE id = $1`, [id]);
  if (rowCount === 0) throw new HttpError(404, 'inspection_not_found');
}

// ---- summary (for the dashboard "upkeep" snapshot) ------------------------

export async function operationsSummary(householdId: string) {
  await getHousehold(householdId);
  const pool = db();
  const [wo, spend, insp, vend] = await Promise.all([
    pool.query(
      `SELECT status, count(*)::int AS n FROM work_orders WHERE household_id = $1 GROUP BY status`, [householdId]),
    pool.query(
      `SELECT COALESCE(SUM(actual_cost_paise),0) AS paise FROM work_orders
        WHERE household_id = $1 AND status = 'done' AND date_part('year', updated_at) = date_part('year', now())`, [householdId]),
    pool.query(
      `SELECT rating, inspected_on FROM inspections WHERE household_id = $1 ORDER BY inspected_on DESC LIMIT 1`, [householdId]),
    pool.query(`SELECT count(*)::int AS n FROM vendors WHERE household_id = $1`, [householdId]),
  ]);

  const byStatus: Record<string, number> = { open: 0, in_progress: 0, done: 0, cancelled: 0 };
  for (const r of wo.rows) byStatus[r.status] = r.n;

  return {
    workOrders: {
      open: byStatus.open,
      inProgress: byStatus.in_progress,
      done: byStatus.done,
      cancelled: byStatus.cancelled,
      active: byStatus.open + byStatus.in_progress,
    },
    maintenanceSpendYtd: paiseToRupees(spend.rows[0].paise),
    vendors: vend.rows[0].n,
    lastInspection: insp.rows[0] ? { rating: insp.rows[0].rating, on: insp.rows[0].inspected_on } : null,
  };
}
