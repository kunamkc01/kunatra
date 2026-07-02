// Approval workflow — operations proposes a spend/change, an owner decides.
// Recommend-and-record: approving just records the decision (never executes).
import { db, rupeesToPaise, paiseToRupees, HttpError } from './pool.ts';
import { getHousehold } from './repo.ts';
import { notifyMoneyManagers, appUrl } from './notify.ts';
import type { AuthUser } from './auth.ts';

const row = (r: any) => ({
  id: r.id, householdId: r.household_id, requestedBy: r.requested_by ?? null,
  title: r.title, amount: r.amount_paise != null ? paiseToRupees(r.amount_paise) : null,
  note: r.note ?? null, status: r.status, decidedBy: r.decided_by ?? null,
  decisionNote: r.decision_note ?? null, decidedAt: r.decided_at ?? null, createdAt: r.created_at,
});

/** Owners see every request; operations see only the ones they raised. */
export async function listApprovals(householdId: string, user: AuthUser) {
  await getHousehold(householdId);
  const q = user.role === 'owner'
    ? [`SELECT * FROM approval_requests WHERE household_id = $1 ORDER BY (status='pending') DESC, created_at DESC`, [householdId]]
    : [`SELECT * FROM approval_requests WHERE household_id = $1 AND requested_by = $2 ORDER BY created_at DESC`, [householdId, user.email]];
  const { rows } = await db().query(q[0] as string, q[1] as any[]);
  return rows.map(row);
}

export async function createApproval(householdId: string, user: AuthUser, body: any) {
  await getHousehold(householdId);
  const title = typeof body.title === 'string' && body.title.trim();
  if (!title) throw new HttpError(400, 'invalid_input', 'title is required');
  let amountPaise: number | null = null;
  if (body.amount != null && body.amount !== '') {
    const n = Number(body.amount);
    if (!Number.isFinite(n) || n < 0) throw new HttpError(400, 'invalid_input', 'amount must be a non-negative number');
    amountPaise = rupeesToPaise(n);
  }
  const { rows } = await db().query(
    `INSERT INTO approval_requests (household_id, requested_by, title, amount_paise, note)
     VALUES ($1,$2,$3,$4,$5) RETURNING *`,
    [householdId, user.email, title, amountPaise, typeof body.note === 'string' ? body.note.trim() : null]
  );
  // Tell the owners/managers there's something to decide (best-effort).
  const amt = amountPaise != null ? ` (₹${paiseToRupees(amountPaise).toLocaleString('en-IN')})` : '';
  void notifyMoneyManagers(householdId,
    `New approval request: ${title}`,
    `${user.email} raised an approval request${amt} on your Kunatra household:\n\n${title}\n\nReview & decide: ${appUrl}/operations`,
    `Kunatra: ${user.email} needs approval — ${title}${amt}`);
  return row(rows[0]);
}

/** Owner approves or rejects a pending request. */
export async function decideApproval(id: string, user: AuthUser, body: any) {
  const decision = body.decision === 'approved' ? 'approved' : body.decision === 'rejected' ? 'rejected' : null;
  if (!decision) throw new HttpError(400, 'invalid_input', "decision must be 'approved' or 'rejected'");
  const { rows } = await db().query(
    `UPDATE approval_requests
        SET status = $2, decided_by = $3, decision_note = $4, decided_at = now()
      WHERE id = $1 AND status = 'pending' RETURNING *`,
    [id, decision, user.email, typeof body.note === 'string' ? body.note.trim() : null]
  );
  if (rows.length === 0) throw new HttpError(409, 'not_pending', 'This request is not pending');
  return row(rows[0]);
}

export async function deleteApproval(id: string) {
  const { rowCount } = await db().query(`DELETE FROM approval_requests WHERE id = $1`, [id]);
  if (rowCount === 0) throw new HttpError(404, 'not_found');
}

export async function approvalsSummary(householdId: string) {
  await getHousehold(householdId);
  const { rows } = await db().query(
    `SELECT count(*) FILTER (WHERE status='pending')::int AS pending FROM approval_requests WHERE household_id = $1`,
    [householdId]
  );
  return { pending: rows[0].pending };
}
