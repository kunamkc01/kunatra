import { pathToFileURL } from 'node:url';
import express, { type Request, type Response, type NextFunction } from 'express';
import { assess, salariedSample } from '@atlas/engine';
import { loadPosition, memberAssessments } from './db.ts';
import { HttpError } from './pool.ts';
import * as repo from './repo.ts';
import * as ops from './ops.ts';
import * as auth from './auth.ts';
import * as compliance from './compliance.ts';
import * as approvals from './approvals.ts';
import { auditMiddleware, listAudit } from './audit.ts';

export const app = express();
app.use(express.json());

// Permissive CORS for local development (Next.js dev server on :3000).
app.use((_req, res, next) => {
  res.header('Access-Control-Allow-Origin', process.env.CORS_ORIGIN ?? '*');
  res.header('Access-Control-Allow-Methods', 'GET,POST,PATCH,DELETE,OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type,Authorization');
  if (_req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

/** Wrap an async handler so thrown errors reach the error middleware. */
const h =
  (fn: (req: Request, res: Response) => Promise<unknown>) =>
  (req: Request, res: Response, next: NextFunction) =>
    fn(req, res).catch(next);

app.get('/health', (_req, res) => res.json({ ok: true }));

// ---- auth (public) --------------------------------------------------------
app.post('/api/auth/register', h(async (req, res) => res.status(201).json(await auth.register(req.body))));
app.post('/api/auth/login', h(async (req, res) => res.json(await auth.login(req.body))));
app.post('/api/auth/forgot', h(async (req, res) => res.json(await auth.requestReset(req.body))));
app.post('/api/auth/reset', h(async (req, res) => res.json(await auth.resetWithToken(req.body))));

// Demo assessment for the bundled sample persona (no real data, so public).
app.get('/api/assessment', h(async (_req, res) => res.json(assess(salariedSample))));

// Everything else under /api requires a valid session.
app.use((req, res, next) => {
  if (req.method === 'OPTIONS' || !req.path.startsWith('/api/')) return next();
  return auth.authenticate(req, res, next);
});

const { requireRole, sameHousehold, scopeResource, scopeVia } = auth;
const ownerOnly = requireRole('owner');
const financialView = requireRole('owner', 'advisor'); // read-only advisors see the money view

// Advisors are strictly read-only — except for their own profile & password.
app.use((req, res, next) => {
  if (req.user?.role === 'advisor' && ['POST', 'PATCH', 'DELETE'].includes(req.method)
      && req.path.startsWith('/api/') && !req.path.startsWith('/api/auth/')) {
    return next(new HttpError(403, 'read_only', 'Advisors have read-only access'));
  }
  next();
});

// Record who changed what (runs after authentication, before the handlers).
app.use(auditMiddleware);

// ---- current user & profile ----------------------------------------------
app.get('/api/auth/me', h(async (req, res) => res.json(await auth.getUserById(req.user!.id))));
app.patch('/api/auth/profile', h(async (req, res) => res.json(await auth.updateProfile(req.user!.id, req.body))));
app.post('/api/auth/password', h(async (req, res) => res.json(await auth.changePassword(req.user!.id, req.body))));

// ---- households ----------------------------------------------------------
app.get('/api/households/:id', sameHousehold, h(async (req, res) => {
  const hh = await repo.getHousehold(req.params.id);
  // Financial totals are hidden from operations users (owners and advisors see them).
  if (req.user!.role === 'operations') { hh.monthlyTakeHome = null; hh.monthlyEssential = null; }
  res.json(hh);
}));
app.patch('/api/households/:id', sameHousehold, ownerOnly, h(async (req, res) => res.json(await repo.updateHousehold(req.params.id, req.body))));
app.delete('/api/households/:id', sameHousehold, ownerOnly, h(async (req, res) => { await repo.deleteHousehold(req.params.id); res.sendStatus(204); }));

// ---- assessment (owner only — the net-worth/exposure picture) ------------
app.get('/api/households/:id/assessment', sameHousehold, financialView, h(async (req, res) => {
  res.json(assess(await loadPosition(req.params.id), new Date()));
}));

// ---- assets (owner + operations; delete is an owner decision) ------------
app.get('/api/households/:id/assets', sameHousehold, h(async (req, res) => res.json(await repo.listAssets(req.params.id))));
app.post('/api/households/:id/assets', sameHousehold, h(async (req, res) => res.status(201).json(await repo.createAsset(req.params.id, req.body))));
app.get('/api/assets/:id', scopeResource('assets'), h(async (req, res) => res.json(await repo.getAsset(req.params.id))));
app.patch('/api/assets/:id', scopeResource('assets'), h(async (req, res) => res.json(await repo.updateAsset(req.params.id, req.body))));
app.delete('/api/assets/:id', scopeResource('assets'), ownerOnly, h(async (req, res) => { await repo.deleteAsset(req.params.id); res.sendStatus(204); }));

// ---- valuations (appreciation history; owner + operations keep values fresh) ----
app.get('/api/assets/:id/valuations', scopeResource('assets'), h(async (req, res) => res.json(await repo.listValuations(req.params.id))));
app.post('/api/assets/:id/valuations', scopeResource('assets'), h(async (req, res) => res.status(201).json(await repo.addValuation(req.params.id, req.body))));
app.delete('/api/valuations/:id', scopeVia('SELECT a.household_id FROM valuations v JOIN assets a ON a.id = v.asset_id WHERE v.id = $1'), h(async (req, res) => { await repo.deleteValuation(req.params.id); res.sendStatus(204); }));

// ---- contributions ledger (drives XIRR; owner + operations) --------------
app.get('/api/assets/:id/contributions', scopeResource('assets'), h(async (req, res) => res.json(await repo.listContributions(req.params.id))));
app.post('/api/assets/:id/contributions', scopeResource('assets'), h(async (req, res) => res.status(201).json(await repo.addContribution(req.params.id, req.body))));
app.post('/api/assets/:id/contributions/schedule', scopeResource('assets'), h(async (req, res) => res.status(201).json(await repo.addSipSchedule(req.params.id, req.body))));
app.delete('/api/contributions/:id', scopeVia('SELECT a.household_id FROM contributions c JOIN assets a ON a.id = c.asset_id WHERE c.id = $1'), h(async (req, res) => { await repo.deleteContribution(req.params.id); res.sendStatus(204); }));

// ---- loans (owner only — debt is an owner decision) ----------------------
app.get('/api/households/:id/loans', sameHousehold, financialView, h(async (req, res) => res.json(await repo.listLoans(req.params.id))));
app.post('/api/households/:id/loans', sameHousehold, ownerOnly, h(async (req, res) => res.status(201).json(await repo.createLoan(req.params.id, req.body))));
app.patch('/api/loans/:id', scopeResource('loans'), ownerOnly, h(async (req, res) => res.json(await repo.updateLoan(req.params.id, req.body))));
app.delete('/api/loans/:id', scopeResource('loans'), ownerOnly, h(async (req, res) => { await repo.deleteLoan(req.params.id); res.sendStatus(204); }));

// ---- operations: vendors (owner + operations) ----------------------------
app.get('/api/households/:id/vendors', sameHousehold, h(async (req, res) => res.json(await ops.listVendors(req.params.id))));
app.post('/api/households/:id/vendors', sameHousehold, h(async (req, res) => res.status(201).json(await ops.createVendor(req.params.id, req.body))));
app.patch('/api/vendors/:id', scopeResource('vendors'), h(async (req, res) => res.json(await ops.updateVendor(req.params.id, req.body))));
app.delete('/api/vendors/:id', scopeResource('vendors'), h(async (req, res) => { await ops.deleteVendor(req.params.id); res.sendStatus(204); }));

// ---- operations: work orders (owner + operations) ------------------------
app.get('/api/households/:id/work-orders', sameHousehold, h(async (req, res) => res.json(await ops.listWorkOrders(req.params.id))));
app.post('/api/households/:id/work-orders', sameHousehold, h(async (req, res) => res.status(201).json(await ops.createWorkOrder(req.params.id, req.body))));
app.get('/api/work-orders/:id', scopeResource('work_orders'), h(async (req, res) => res.json(await ops.getWorkOrder(req.params.id))));
app.patch('/api/work-orders/:id', scopeResource('work_orders'), h(async (req, res) => res.json(await ops.updateWorkOrder(req.params.id, req.body))));
app.delete('/api/work-orders/:id', scopeResource('work_orders'), h(async (req, res) => { await ops.deleteWorkOrder(req.params.id); res.sendStatus(204); }));

// ---- operations: inspections & summary (owner + operations) --------------
app.get('/api/households/:id/inspections', sameHousehold, h(async (req, res) => res.json(await ops.listInspections(req.params.id))));
app.post('/api/households/:id/inspections', sameHousehold, h(async (req, res) => res.status(201).json(await ops.createInspection(req.params.id, req.body))));
app.delete('/api/inspections/:id', scopeResource('inspections'), h(async (req, res) => { await ops.deleteInspection(req.params.id); res.sendStatus(204); }));
app.get('/api/households/:id/operations/summary', sameHousehold, h(async (req, res) => res.json(await ops.operationsSummary(req.params.id))));

// ---- family members ------------------------------------------------------
// Operations can see member names (to attribute assets) but not their incomes.
app.get('/api/households/:id/members', sameHousehold, h(async (req, res) => {
  const list = await repo.listMembers(req.params.id);
  if (req.user!.role === 'operations') list.forEach((m: any) => { m.monthlyIncome = null; m.monthlyEssential = null; });
  res.json(list);
}));
app.post('/api/households/:id/members', sameHousehold, ownerOnly, h(async (req, res) => res.status(201).json(await repo.createMember(req.params.id, req.body))));
app.patch('/api/members/:id', scopeResource('members'), ownerOnly, h(async (req, res) => res.json(await repo.updateMember(req.params.id, req.body))));
app.delete('/api/members/:id', scopeResource('members'), ownerOnly, h(async (req, res) => { await repo.deleteMember(req.params.id); res.sendStatus(204); }));
// Per-member net worth & exposure (owner only — financial).
app.get('/api/households/:id/members/assessment', sameHousehold, financialView, h(async (req, res) => res.json(await memberAssessments(req.params.id, new Date()))));

// ---- compliance calendar (owner + operations track/complete due dates) ---
app.get('/api/households/:id/compliance', sameHousehold, h(async (req, res) => res.json(await compliance.listCompliance(req.params.id))));
app.get('/api/households/:id/compliance/summary', sameHousehold, h(async (req, res) => res.json(await compliance.complianceSummary(req.params.id))));
app.post('/api/households/:id/compliance', sameHousehold, h(async (req, res) => res.status(201).json(await compliance.createCompliance(req.params.id, req.body))));
app.patch('/api/compliance/:id', scopeResource('compliance_items'), h(async (req, res) => res.json(await compliance.updateCompliance(req.params.id, req.body))));
app.post('/api/compliance/:id/complete', scopeResource('compliance_items'), h(async (req, res) => res.json(await compliance.completeCompliance(req.params.id))));
app.delete('/api/compliance/:id', scopeResource('compliance_items'), h(async (req, res) => { await compliance.deleteCompliance(req.params.id); res.sendStatus(204); }));

// ---- approval workflow (operations propose → owner decides) ---------------
const opsOrOwner = requireRole('owner', 'operations');
app.get('/api/households/:id/approvals', sameHousehold, opsOrOwner, h(async (req, res) => res.json(await approvals.listApprovals(req.params.id, req.user!))));
app.get('/api/households/:id/approvals/summary', sameHousehold, ownerOnly, h(async (req, res) => res.json(await approvals.approvalsSummary(req.params.id))));
app.post('/api/households/:id/approvals', sameHousehold, opsOrOwner, h(async (req, res) => res.status(201).json(await approvals.createApproval(req.params.id, req.user!, req.body))));
app.post('/api/approvals/:id/decide', scopeResource('approval_requests'), ownerOnly, h(async (req, res) => res.json(await approvals.decideApproval(req.params.id, req.user!, req.body))));
app.delete('/api/approvals/:id', scopeResource('approval_requests'), ownerOnly, h(async (req, res) => { await approvals.deleteApproval(req.params.id); res.sendStatus(204); }));

// ---- audit trail (owner only — oversight) --------------------------------
app.get('/api/households/:id/audit', sameHousehold, ownerOnly, h(async (req, res) => res.json(await listAudit(req.params.id))));

// ---- team / users (owner only) -------------------------------------------
app.get('/api/households/:id/users', sameHousehold, ownerOnly, h(async (req, res) => res.json(await auth.listUsers(req.params.id))));
app.post('/api/households/:id/users', sameHousehold, ownerOnly, h(async (req, res) => res.status(201).json(await auth.createUser(req.params.id, req.body))));
app.delete('/api/users/:id', scopeResource('users'), ownerOnly, h(async (req, res) => {
  if (req.params.id === req.user!.id) throw new HttpError(400, 'cannot_delete_self', "You can't remove your own account");
  await auth.deleteUser(req.params.id);
  res.sendStatus(204);
}));
app.post('/api/users/:id/reset-password', scopeResource('users'), ownerOnly, h(async (req, res) => res.json(await auth.setPassword(req.params.id, req.body.newPassword))));

// ---- error handling ------------------------------------------------------
app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  if (err instanceof HttpError) return res.status(err.status).json({ error: err.code, message: err.message });
  console.error(err);
  res.status(500).json({ error: 'internal_error' });
});

// Only start the server when run directly (not when imported by tests).
const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  const port = Number(process.env.PORT ?? 4000);
  app.listen(port, () => console.log(`Kunatra API on :${port}`));
}
