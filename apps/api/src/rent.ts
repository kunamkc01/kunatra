// Rent roll — one line per rented property per month, generated on the calendar
// (independent of whether the prior month was collected). Mark each collected.
import { db, rupeesToPaise, paiseToRupees, HttpError } from './pool.ts';
import { getHousehold } from './repo.ts';

const rentRow = (r: any) => ({
  id: r.id, householdId: r.household_id, assetId: r.asset_id, assetName: r.asset_name ?? null,
  periodMonth: r.period_month, // 'YYYY-MM-01'
  amountDue: paiseToRupees(r.amount_due_paise),
  tds: paiseToRupees(r.tds_paise),
  netDue: paiseToRupees(r.amount_due_paise) - paiseToRupees(r.tds_paise),
  status: r.status,
  collectedOn: r.collected_on ?? null,
  collected: r.collected_paise != null ? paiseToRupees(r.collected_paise) : null,
  note: r.note ?? null,
});

/**
 * Open this month's rent line for every rented property (monthly_rent > 0) that
 * doesn't have one yet. Scoped to one household when given, else all. Idempotent.
 */
export async function generateRentDue(householdId?: string): Promise<number> {
  if (!process.env.DATABASE_URL) return 0;
  const params: any[] = [];
  let filter = '';
  if (householdId) { params.push(householdId); filter = `AND household_id = $1`; }
  const { rowCount } = await db().query(
    `INSERT INTO rent_collections (household_id, asset_id, period_month, amount_due_paise, tds_paise)
     SELECT household_id, id, date_trunc('month', current_date)::date, monthly_rent_paise, COALESCE(monthly_rent_tds_paise, 0)
       FROM assets
      WHERE monthly_rent_paise IS NOT NULL AND monthly_rent_paise > 0 ${filter}
     ON CONFLICT (asset_id, period_month) DO NOTHING`,
    params
  );
  return rowCount ?? 0;
}

export async function listRentCollections(householdId: string) {
  await getHousehold(householdId);
  await generateRentDue(householdId); // make sure the current month is present on view
  const { rows } = await db().query(
    `SELECT rc.*, a.name AS asset_name
       FROM rent_collections rc JOIN assets a ON a.id = rc.asset_id
      WHERE rc.household_id = $1
      ORDER BY rc.period_month DESC, a.name`,
    [householdId]
  );
  return rows.map(rentRow);
}

export async function rentSummary(householdId: string) {
  await getHousehold(householdId);
  const { rows } = await db().query(
    `SELECT count(*) FILTER (WHERE status = 'due') AS outstanding_count,
            COALESCE(sum(amount_due_paise - tds_paise) FILTER (WHERE status = 'due'), 0) AS outstanding_paise,
            count(*) FILTER (WHERE status = 'due' AND period_month < date_trunc('month', current_date)) AS overdue_count
       FROM rent_collections WHERE household_id = $1`,
    [householdId]
  );
  const r = rows[0];
  return {
    outstandingCount: Number(r.outstanding_count),
    outstanding: paiseToRupees(r.outstanding_paise),
    overdueCount: Number(r.overdue_count),
  };
}

/**
 * Actual rent vs the AI market estimate, per rented property + a portfolio
 * rollup. Pure comparison of stored numbers — no AI calls. This is an INSIGHT
 * (the estimate side is an AI figure with a confidence), not engine fact.
 */
export async function rentMarketGap(householdId: string) {
  await getHousehold(householdId);
  const { rows } = await db().query(
    `SELECT a.id AS asset_id, a.name, a.monthly_rent_paise, pv.estimated_rent_paise, pv.confidence
       FROM assets a JOIN property_valuations pv ON pv.asset_id = a.id
      WHERE a.household_id = $1 AND a.monthly_rent_paise > 0
        AND pv.status = 'ok' AND pv.estimated_rent_paise IS NOT NULL
      ORDER BY (pv.estimated_rent_paise - a.monthly_rent_paise) DESC`,
    [householdId]
  );
  const items = rows.map((r) => {
    const actual = paiseToRupees(r.monthly_rent_paise);
    const market = paiseToRupees(r.estimated_rent_paise);
    return {
      assetId: r.asset_id, name: r.name,
      actualRent: actual, marketRent: market,
      gapMonthly: market - actual, gapYearly: (market - actual) * 12,
      gapPct: actual > 0 ? ((market - actual) / actual) * 100 : null,
      confidence: r.confidence ?? null,
    };
  });
  const underMarket = items.filter((i) => i.gapMonthly > 0);
  return {
    items,
    totalYearlyGap: underMarket.reduce((s, i) => s + i.gapYearly, 0), // money left on the table
    underMarketCount: underMarket.length,
    comparedCount: items.length,
  };
}

/** Mark a rent line collected (defaults to today, net-of-TDS amount). */
export async function collectRent(id: string, body: any) {
  const on = typeof body.on === 'string' && body.on ? body.on : null;
  const amount = body.amount != null && body.amount !== '' ? Number(body.amount) : null;
  if (amount != null && (!Number.isFinite(amount) || amount < 0)) {
    throw new HttpError(400, 'invalid_input', 'amount must be a non-negative number');
  }
  const { rows } = await db().query(
    `UPDATE rent_collections
        SET status = 'collected',
            collected_on = COALESCE($2::date, current_date),
            collected_paise = COALESCE($3::bigint, amount_due_paise - tds_paise)
      WHERE id = $1 RETURNING *`,
    [id, on, amount != null ? rupeesToPaise(amount) : null]
  );
  if (rows.length === 0) throw new HttpError(404, 'rent_not_found');
  return rentRow(rows[0]);
}

/** Change a rent line's state — undo a collection (back to due) or waive it. */
export async function updateRent(id: string, body: any) {
  const status = body.status;
  if (!['due', 'collected', 'waived'].includes(status)) throw new HttpError(400, 'invalid_input', 'invalid status');
  const clear = status !== 'collected'; // due/waived have no collection recorded
  const { rows } = await db().query(
    `UPDATE rent_collections
        SET status = $2,
            collected_on = CASE WHEN $3 THEN NULL ELSE collected_on END,
            collected_paise = CASE WHEN $3 THEN NULL ELSE collected_paise END,
            note = COALESCE($4, note)
      WHERE id = $1 RETURNING *`,
    [id, status, clear, typeof body.note === 'string' ? body.note.trim() : null]
  );
  if (rows.length === 0) throw new HttpError(404, 'rent_not_found');
  return rentRow(rows[0]);
}
