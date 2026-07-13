/**
 * Personal loans given (lent out) and taken (borrowed), with periodic interest.
 * Principal folds into net worth (given → assets, taken → liabilities) via
 * loadPosition; interest is computed from rate + frequency and can also be
 * logged as actual receipts/payments.
 */
import { db, paiseToRupees, rupeesToPaise, HttpError } from './pool.ts';

const DIRECTIONS = ['given', 'taken'] as const;
const FREQUENCIES = ['monthly', 'quarterly', 'half_yearly', 'yearly'] as const;
const PERIODS_PER_YEAR: Record<string, number> = { monthly: 12, quarterly: 4, half_yearly: 2, yearly: 1 };
const oneOf = <T extends readonly string[]>(v: any, allowed: T, fallback: T[number]): T[number] =>
  allowed.includes(v) ? v : fallback;
const posInt = (v: any): number => { const n = Math.round(Number(v)); return Number.isFinite(n) && n >= 0 ? n : 0; };

/** Interest for one payment period, in rupees (principal × rate ÷ periods/year). */
export function periodicInterest(principalRupees: number, ratePct: number | null, frequency: string): number {
  if (!ratePct || ratePct <= 0) return 0;
  return (principalRupees * (ratePct / 100)) / (PERIODS_PER_YEAR[frequency] ?? 12);
}
const monthlyInterest = (principal: number, ratePct: number | null) =>
  !ratePct || ratePct <= 0 ? 0 : (principal * (ratePct / 100)) / 12;

const row = (r: any) => {
  const principal = paiseToRupees(r.principal_paise);
  const ratePct = r.rate_pct != null ? Number(r.rate_pct) : null;
  return {
    id: r.id,
    householdId: r.household_id,
    direction: r.direction as 'given' | 'taken',
    counterparty: r.counterparty,
    principal,
    ratePct,
    frequency: r.frequency as string,
    startedOn: r.started_on ?? null,
    memberId: r.member_id ?? null,
    note: r.note ?? null,
    interestPerPeriod: Math.round(periodicInterest(principal, ratePct, r.frequency)),
    monthlyInterest: Math.round(monthlyInterest(principal, ratePct)),
    annualInterest: ratePct ? Math.round(principal * (ratePct / 100)) : 0,
  };
};

export async function listPersonalLoans(householdId: string) {
  const { rows } = await db().query(
    `SELECT * FROM personal_loans WHERE household_id = $1 ORDER BY direction, created_at DESC`, [householdId]);
  return rows.map(row);
}

/** List + a net summary — the "net value shown" for the section. */
export async function personalLoanSummary(householdId: string) {
  const loans = await listPersonalLoans(householdId);
  const given = loans.filter((l) => l.direction === 'given');
  const taken = loans.filter((l) => l.direction === 'taken');
  const sum = (xs: any[], k: string) => xs.reduce((s, x) => s + x[k], 0);
  const givenPrincipal = sum(given, 'principal');
  const takenPrincipal = sum(taken, 'principal');

  // Actual interest logged over the last 12 months (given = received, taken = paid).
  const { rows: acts } = await db().query(
    `SELECT pl.direction, COALESCE(SUM(p.amount_paise), 0) AS paise
       FROM personal_loan_payments p JOIN personal_loans pl ON pl.id = p.loan_id
      WHERE p.household_id = $1 AND p.kind = 'interest' AND p.paid_on >= (CURRENT_DATE - INTERVAL '12 months')
      GROUP BY pl.direction`, [householdId]);
  const actual = { given: 0, taken: 0 };
  for (const a of acts) actual[a.direction as 'given' | 'taken'] = paiseToRupees(a.paise);

  return {
    loans,
    given, taken,
    givenPrincipal, takenPrincipal,
    netPrincipal: givenPrincipal - takenPrincipal,          // adds to net worth
    monthlyInterestIn: sum(given, 'monthlyInterest'),
    monthlyInterestOut: sum(taken, 'monthlyInterest'),
    annualInterestIn: sum(given, 'annualInterest'),
    annualInterestOut: sum(taken, 'annualInterest'),
    interestReceivedLast12: actual.given,
    interestPaidLast12: actual.taken,
  };
}

/** Principal totals used by loadPosition to fold into net worth. */
export async function positionAdjustment(householdId: string): Promise<{ givenPrincipal: number; takenPrincipal: number }> {
  const { rows } = await db().query(
    `SELECT direction, COALESCE(SUM(principal_paise), 0) AS paise FROM personal_loans WHERE household_id = $1 GROUP BY direction`,
    [householdId]);
  let given = 0, taken = 0;
  for (const r of rows) { if (r.direction === 'given') given = paiseToRupees(r.paise); else taken = paiseToRupees(r.paise); }
  return { givenPrincipal: given, takenPrincipal: taken };
}

export async function createPersonalLoan(householdId: string, body: any) {
  const counterparty = typeof body.counterparty === 'string' ? body.counterparty.trim() : '';
  if (!counterparty) throw new HttpError(400, 'invalid_input', 'counterparty is required');
  const { rows } = await db().query(
    `INSERT INTO personal_loans (household_id, direction, counterparty, principal_paise, rate_pct, frequency, started_on, member_id, note)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
    [householdId, oneOf(body.direction, DIRECTIONS, 'given'), counterparty, rupeesToPaise(posInt(body.principal)),
     body.ratePct != null && body.ratePct !== '' ? Number(body.ratePct) : null,
     oneOf(body.frequency, FREQUENCIES, 'monthly'),
     body.startedOn || null, body.memberId || null, body.note?.trim() || null]);
  return row(rows[0]);
}

export async function updatePersonalLoan(id: string, body: any) {
  const sets: string[] = []; const vals: any[] = []; let i = 1;
  const push = (col: string, v: any) => { sets.push(`${col} = $${i++}`); vals.push(v); };
  if (body.counterparty !== undefined) push('counterparty', String(body.counterparty).trim());
  if (body.direction !== undefined) push('direction', oneOf(body.direction, DIRECTIONS, 'given'));
  if (body.principal !== undefined) push('principal_paise', rupeesToPaise(posInt(body.principal)));
  if (body.ratePct !== undefined) push('rate_pct', body.ratePct != null && body.ratePct !== '' ? Number(body.ratePct) : null);
  if (body.frequency !== undefined) push('frequency', oneOf(body.frequency, FREQUENCIES, 'monthly'));
  if (body.startedOn !== undefined) push('started_on', body.startedOn || null);
  if (body.memberId !== undefined) push('member_id', body.memberId || null);
  if (body.note !== undefined) push('note', body.note?.trim() || null);
  if (!sets.length) { const { rows } = await db().query(`SELECT * FROM personal_loans WHERE id = $1`, [id]); return row(rows[0]); }
  vals.push(id);
  const { rows } = await db().query(`UPDATE personal_loans SET ${sets.join(', ')}, updated_at = now() WHERE id = $${i} RETURNING *`, vals);
  if (!rows[0]) throw new HttpError(404, 'not_found');
  return row(rows[0]);
}

export async function deletePersonalLoan(id: string) {
  await db().query(`DELETE FROM personal_loans WHERE id = $1`, [id]);
}

// ---- interest ledger --------------------------------------------------------
const paymentRow = (r: any) => ({
  id: r.id, loanId: r.loan_id, paidOn: r.paid_on, amount: paiseToRupees(r.amount_paise), kind: r.kind, note: r.note ?? null,
});

export async function listPayments(loanId: string) {
  const { rows } = await db().query(`SELECT * FROM personal_loan_payments WHERE loan_id = $1 ORDER BY paid_on DESC`, [loanId]);
  return rows.map(paymentRow);
}

export async function addPayment(loanId: string, body: any) {
  const { rows: hh } = await db().query(`SELECT household_id FROM personal_loans WHERE id = $1`, [loanId]);
  if (!hh[0]) throw new HttpError(404, 'not_found');
  if (!body.paidOn) throw new HttpError(400, 'invalid_input', 'paidOn is required');
  const { rows } = await db().query(
    `INSERT INTO personal_loan_payments (loan_id, household_id, paid_on, amount_paise, kind, note)
     VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
    [loanId, hh[0].household_id, body.paidOn, rupeesToPaise(posInt(body.amount)),
     body.kind === 'principal' ? 'principal' : 'interest', body.note?.trim() || null]);
  return paymentRow(rows[0]);
}

export async function deletePayment(id: string) {
  await db().query(`DELETE FROM personal_loan_payments WHERE id = $1`, [id]);
}
