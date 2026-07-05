// Rent roll — one line per rented property per month, generated on the calendar
// (independent of whether the prior month was collected). Mark each collected.
import { db, rupeesToPaise, paiseToRupees, HttpError } from './pool.ts';
import { getHousehold } from './repo.ts';
import { saveGenerated } from './documents.ts';

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


// ---- rent receipts (HRA paperwork; print-friendly, zero dependencies) --------

export interface ReceiptData {
  rentId: string; assetId: string;
  landlordName: string | null; tenantName: string | null;
  propertyName: string; propertyAddress: string | null;
  periodMonth: string; amountDue: number; tds: number; netDue: number;
  collectedOn: string | null; collected: number | null; status: string;
  householdName: string;
}

async function receiptRows(where: string, params: any[]): Promise<ReceiptData[]> {
  const { rows } = await db().query(
    `SELECT rc.*, a.name AS asset_name, a.tenant_name, p.address,
            h.display_name AS household_name,
            (SELECT m.name FROM memberships ms JOIN members m ON m.id = ms.member_id
              WHERE ms.household_id = rc.household_id AND ms.role = 'owner' AND ms.member_id IS NOT NULL
              ORDER BY ms.created_at LIMIT 1) AS landlord_name
       FROM rent_collections rc
       JOIN assets a ON a.id = rc.asset_id
       LEFT JOIN real_estate_profiles p ON p.asset_id = a.id
       JOIN households h ON h.id = rc.household_id
      WHERE ${where}
      ORDER BY rc.period_month`, params);
  return rows.map((r) => ({
    rentId: r.id, assetId: r.asset_id,
    landlordName: r.landlord_name ?? null, tenantName: r.tenant_name ?? null,
    propertyName: r.asset_name, propertyAddress: r.address ?? null,
    periodMonth: r.period_month,
    amountDue: paiseToRupees(r.amount_due_paise), tds: paiseToRupees(r.tds_paise),
    netDue: paiseToRupees(r.amount_due_paise) - paiseToRupees(r.tds_paise),
    collectedOn: r.collected_on ?? null,
    collected: r.collected_paise != null ? paiseToRupees(r.collected_paise) : null,
    status: r.status, householdName: r.household_name,
  }));
}

export async function rentReceipt(rentId: string): Promise<ReceiptData> {
  const rows = await receiptRows('rc.id = $1', [rentId]);
  if (!rows[0]) throw new HttpError(404, 'rent_not_found');
  return rows[0];
}

/** All collected receipts for an Indian financial year (Apr 1 – Mar 31). */
export async function receiptsForYear(assetId: string, fyStart: number): Promise<ReceiptData[]> {
  if (!Number.isInteger(fyStart) || fyStart < 2000 || fyStart > 2100) {
    throw new HttpError(400, 'invalid_input', 'fy must be the starting year, e.g. 2025 for FY25-26');
  }
  return receiptRows(
    `rc.asset_id = $1 AND rc.status = 'collected' AND rc.period_month >= $2 AND rc.period_month < $3`,
    [assetId, `${fyStart}-04-01`, `${fyStart + 1}-04-01`]);
}

const month = (iso: string) => new Date(`${String(iso).slice(0, 10)}T00:00:00`).toLocaleDateString('en-IN', { month: 'long', year: 'numeric' });
const inr = (n: number) => '₹' + Math.round(n).toLocaleString('en-IN');

/** A self-contained receipt HTML (also what gets filed into the vault). */
export function receiptHtml(d: ReceiptData): string {
  return `<!doctype html><html><head><meta charset="utf-8"><title>Rent receipt — ${d.propertyName} — ${month(d.periodMonth)}</title>
<style>body{font-family:Georgia,serif;max-width:640px;margin:40px auto;color:#16243f;line-height:1.6}
h1{font-size:22px;border-bottom:2px solid #16243f;padding-bottom:8px}table{width:100%;border-collapse:collapse;margin:16px 0}
td{padding:7px 4px;border-bottom:1px solid #e3e6ec;font-size:15px}td:first-child{color:#5a6473;width:40%}
.f{margin-top:36px;color:#8a92a0;font-size:12px}</style></head><body>
<h1>Rent Receipt — ${month(d.periodMonth)}</h1>
<table>
<tr><td>Received from (tenant)</td><td>${d.tenantName ?? '—'}</td></tr>
<tr><td>Paid to (landlord)</td><td>${d.landlordName ?? d.householdName}</td></tr>
<tr><td>Property</td><td>${d.propertyName}${d.propertyAddress ? ' — ' + d.propertyAddress : ''}</td></tr>
<tr><td>Rent period</td><td>${month(d.periodMonth)}</td></tr>
<tr><td>Gross rent</td><td>${inr(d.amountDue)}</td></tr>
${d.tds > 0 ? `<tr><td>TDS deducted</td><td>${inr(d.tds)}</td></tr><tr><td>Net rent received</td><td><b>${inr(d.collected ?? d.netDue)}</b></td></tr>` : `<tr><td>Rent received</td><td><b>${inr(d.collected ?? d.netDue)}</b></td></tr>`}
<tr><td>Received on</td><td>${d.collectedOn ?? '—'}</td></tr>
</table>
<div class="f">Generated by Kunatra for ${d.householdName}. This receipt records a rent payment; landlord PAN available from the landlord on request where required for HRA claims.</div>
</body></html>`;
}

/** File this receipt into the document vault, so the paper trail collates itself. */
export async function saveReceiptToVault(rentId: string) {
  const d = await rentReceipt(rentId);
  if (d.status !== 'collected') throw new HttpError(400, 'not_collected', 'Only collected rent gets a receipt');
  const { rows } = await db().query(`SELECT household_id FROM rent_collections WHERE id = $1`, [rentId]);
  const filename = `Rent receipt — ${d.propertyName} — ${String(d.periodMonth).slice(0, 7)}.html`;
  return saveGenerated(d.assetId, rows[0].household_id, 'invoice', filename, receiptHtml(d));
}
