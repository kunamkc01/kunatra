import { pathToFileURL } from 'node:url';
import express, { type Request, type Response, type NextFunction } from 'express';
import { assess, salariedSample } from '@atlas/engine';
import { loadPosition, memberAssessments, assetDetail } from './db.ts';
import { HttpError } from './pool.ts';
import * as repo from './repo.ts';
import * as ops from './ops.ts';
import * as rent from './rent.ts';
import * as valuation from './valuation.ts';
import * as history from './history.ts';
import * as auth from './auth.ts';
import * as compliance from './compliance.ts';
import * as approvals from './approvals.ts';
import { auditMiddleware, listAudit } from './audit.ts';
import { remindDueCompliance } from './notify.ts';
import * as admin from './admin.ts';
import * as access from './access.ts';
import * as pulse from './pulse.ts';
import * as personalLoans from './personalLoans.ts';
import * as funds from './funds.ts';
import * as documents from './documents.ts';
import * as tenant from './tenant.ts';

export const app = express();
// Bodies can carry downscaled images (avatars, asset photos) as data URLs, so
// allow well above the per-photo cap enforced in repo.ts (~2.5MB).
app.use(express.json({ limit: '16mb' })); // documents ≤10MB arrive base64-inflated

// Permissive CORS for local development (Next.js dev server on :3000).
app.use((_req, res, next) => {
  res.header('Access-Control-Allow-Origin', process.env.CORS_ORIGIN ?? '*');
  res.header('Access-Control-Allow-Methods', 'GET,POST,PATCH,DELETE,OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type,Authorization,X-Tenant-Token');
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
app.post('/api/auth/register', h(async (req, res) => {
  const session = await auth.register(req.body);
  void access.recordAuthEvent(req, { event: 'register', success: true, email: session.user.email, userId: session.user.id });
  res.status(201).json(session);
}));
app.post('/api/auth/login', h(async (req, res) => {
  const email = typeof req.body?.email === 'string' ? req.body.email : '';
  try {
    const session = await auth.login(req.body);
    void access.recordAuthEvent(req, { event: 'login', success: true, email: session.user.email, userId: session.user.id });
    res.json(session);
  } catch (e) {
    if (email) void access.recordAuthEvent(req, { event: 'login', success: false, email });
    throw e;
  }
}));
app.post('/api/auth/forgot', h(async (req, res) => res.json(await auth.requestReset(req.body))));
app.post('/api/auth/reset', h(async (req, res) => res.json(await auth.resetWithToken(req.body))));

// Demo assessment for the bundled sample persona (no real data, so public).
app.get('/api/assessment', h(async (_req, res) => res.json(assess(salariedSample))));

// Everything else under /api requires a valid session.
app.use((req, res, next) => {
  if (req.method === 'OPTIONS' || !req.path.startsWith('/api/') || req.path.startsWith('/api/tenant/')) return next();
  return auth.authenticate(req, res, next);
});

// ---- tenant portal (magic-link auth; scoped to ONE property, rate-limited) --
app.use('/api/tenant', tenant.tenantAuth);
app.get('/api/tenant/me', h(async (req, res) => res.json(await tenant.tenantMe(req.tenant!))));
app.get('/api/tenant/requests', h(async (req, res) => res.json(await tenant.tenantRequests(req.tenant!))));
app.post('/api/tenant/requests', h(async (req, res) => res.status(201).json(await tenant.raiseRequest(req.tenant!, req.body))));
app.get('/api/tenant/receipts', h(async (req, res) => res.json(await tenant.tenantReceipts(req.tenant!))));
app.get('/api/tenant/receipts/:id', h(async (req, res) => res.json(await tenant.tenantReceipt(req.tenant!, req.params.id))));
app.get('/api/tenant/documents', h(async (req, res) => res.json(await tenant.tenantDocuments(req.tenant!))));
app.get('/api/tenant/documents/:id/download', h(async (req, res) => {
  const f = await tenant.tenantDocumentFile(req.tenant!, req.params.id);
  res.setHeader('Content-Type', f.contentType);
  res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(f.filename)}"`);
  res.send(f.buffer);
}));

const { requireRole, sameHousehold, scopeResource, scopeVia, scopeOwned, scopeOwnedVia, forceMemberOwnership, memberSelfOnly } = auth;
const ownerOnly = requireRole('owner');                                   // account/team decisions
const manageMoney = requireRole('owner', 'manager');                       // loans, cash flow, members, approvals
const financialView = requireRole('owner', 'manager', 'advisor', 'member'); // everyone but operations sees the money
const editAssets = requireRole('owner', 'manager', 'operations', 'member'); // member is scoped to their own
const editOps = requireRole('owner', 'manager', 'operations');             // upkeep

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

// Access heartbeat — throttled last-seen/geo on the account (never blocks).
app.use((req, _res, next) => { if (req.user) void access.heartbeat(req); next(); });

// ---- current user, profile, household switch ------------------------------
app.get('/api/auth/me', h(async (req, res) => res.json(await auth.me(req.user!))));
app.patch('/api/auth/profile', h(async (req, res) => { await auth.updateProfile(req.user!.id, req.body); res.json(await auth.me(req.user!)); }));
app.post('/api/auth/password', h(async (req, res) => res.json(await auth.changePassword(req.user!.id, req.body))));
app.post('/api/auth/switch', h(async (req, res) => {
  const session = await auth.switchHousehold(req.user!.id, req.body);
  void access.recordAuthEvent(req, { event: 'switch', success: true, email: req.user!.email, userId: req.user!.id });
  res.json(session);
}));
app.get('/api/auth/signins', h(async (req, res) => res.json(await access.mySignins(req.user!.id))));
// Create a new household you own (any authenticated user), and switch to it.
app.post('/api/households', h(async (req, res) => res.status(201).json(await auth.createHousehold(req.user!.id, req.body))));

// ---- households ----------------------------------------------------------
app.get('/api/households/:id', sameHousehold, h(async (req, res) => {
  const hh = await repo.getHousehold(req.params.id);
  // Financial totals are hidden from operations users only.
  if (req.user!.role === 'operations') { hh.monthlyTakeHome = null; hh.monthlyEssential = null; }
  res.json(hh);
}));
app.patch('/api/households/:id', sameHousehold, manageMoney, h(async (req, res) => res.json(await repo.updateHousehold(req.params.id, req.body))));
app.delete('/api/households/:id', sameHousehold, ownerOnly, h(async (req, res) => { await repo.deleteHousehold(req.params.id); res.sendStatus(204); }));

// ---- assessment (the net-worth/exposure picture — everyone but operations) --
app.get('/api/households/:id/assessment', sameHousehold, financialView, h(async (req, res) => {
  res.json(assess(await loadPosition(req.params.id), new Date()));
}));

// Net-worth history — the monthly snapshots behind the trend chart.
app.get('/api/households/:id/networth-history', sameHousehold, financialView, h(async (req, res) => res.json(await history.listHistory(req.params.id))));

// ---- assets (member logins are scoped to their own person) ---------------
app.get('/api/households/:id/assets', sameHousehold, h(async (req, res) => res.json(await repo.listAssets(req.params.id))));
app.post('/api/households/:id/assets', sameHousehold, editAssets, forceMemberOwnership, h(async (req, res) => {
  const created = await repo.createAsset(req.params.id, req.body);
  if (created.assetClass === 'real_estate') void valuation.requestValuation(created.id); // background estimate
  res.status(201).json(created);
}));
app.get('/api/households/:id/property-pulse', sameHousehold, h(async (req, res) =>
  res.json(await pulse.propertyPulse(req.params.id, { financials: req.user!.role !== 'operations' }))));
app.get('/api/assets/:id/pulse', scopeResource('assets'), h(async (req, res) => res.json(await pulse.assetPulse(req.params.id))));
app.get('/api/assets/:id', scopeResource('assets'), h(async (req, res) => res.json(await repo.getAsset(req.params.id))));
app.get('/api/assets/:id/detail', scopeResource('assets'), h(async (req, res) => res.json(await assetDetail(req.params.id, new Date()))));
app.patch('/api/assets/:id', editAssets, scopeOwned('assets'), h(async (req, res) => {
  // Grab the prior profile only when a real-estate profile is being written, so we can tell if the location changed.
  const before = 'realEstate' in req.body ? await repo.getAsset(req.params.id).catch(() => null) : null;
  const updated = await repo.updateAsset(req.params.id, req.body);
  if (updated.assetClass === 'real_estate') {
    const re = req.body.realEstate;
    const norm = (v: any) => (v == null || v === '' ? null : v);
    // The estimate's core inputs are the location and size — if they changed, force a fresh one now.
    const locationChanged = 'realEstate' in req.body && re && before && (
      norm(re.address) !== norm(before.realEstate?.address) ||
      norm(re.city) !== norm(before.realEstate?.city) ||
      norm(re.locality) !== norm(before.realEstate?.locality) ||
      norm(re.sqft) !== norm(before.realEstate?.sqft)
    );
    if (locationChanged) void valuation.requestOnLocationChange(updated.id);
    else if ('realEstate' in req.body || 'monthlyRent' in req.body) void valuation.requestIfStale(updated.id);
  }
  // A fund-linked asset's value is NAV-derived — no edit may leave it stale or zeroed.
  void funds.refreshFundValue(updated.id);
  res.json(updated);
}));

// ---- AI property-valuation (estimate lives beside the user's value) -------
// ---- mutual-fund / SIP NAV valuation (units × latest NAV) ------------------
app.get('/api/funds/search', h(async (req, res) => res.json(await funds.searchSchemes(String(req.query.q ?? '')))));
app.get('/api/assets/:id/fund', scopeResource('assets'), h(async (req, res) => res.json(await funds.getFund(req.params.id))));
app.post('/api/assets/:id/fund', editAssets, scopeOwned('assets'), h(async (req, res) => res.json(await funds.setFund(req.params.id, req.body))));
app.post('/api/assets/:id/fund/refresh', editAssets, scopeOwned('assets'), h(async (req, res) => { await funds.refreshFundValue(req.params.id); res.json(await funds.getFund(req.params.id)); }));
app.delete('/api/assets/:id/fund', editAssets, scopeOwned('assets'), h(async (req, res) => { await funds.unlinkFund(req.params.id); res.sendStatus(204); }));

app.get('/api/assets/:id/valuation', scopeResource('assets'), h(async (req, res) => res.json(await valuation.getValuation(req.params.id))));
app.post('/api/assets/:id/valuation/refresh', editAssets, scopeOwned('assets'), h(async (req, res) => res.json(await valuation.refreshValuation(req.params.id))));
app.post('/api/assets/:id/valuation/feedback', editAssets, scopeOwned('assets'), h(async (req, res) => res.json(await valuation.saveFeedback(req.params.id, req.body))));
app.delete('/api/assets/:id', requireRole('owner', 'manager', 'member'), scopeOwned('assets'), h(async (req, res) => { await repo.deleteAsset(req.params.id); res.sendStatus(204); }));

// ---- valuations & contributions (owner/manager/operations keep them fresh) ----
app.get('/api/assets/:id/valuations', scopeResource('assets'), h(async (req, res) => res.json(await repo.listValuations(req.params.id))));
app.post('/api/assets/:id/valuations', editOps, scopeResource('assets'), h(async (req, res) => res.status(201).json(await repo.addValuation(req.params.id, req.body))));
app.delete('/api/valuations/:id', editOps, scopeVia('SELECT a.household_id FROM valuations v JOIN assets a ON a.id = v.asset_id WHERE v.id = $1'), h(async (req, res) => { await repo.deleteValuation(req.params.id); res.sendStatus(204); }));
// ---- tenant management (owner/manager invite + revoke, per property) ------
app.get('/api/assets/:id/tenant', scopeResource('assets'), manageMoney, h(async (req, res) => res.json(await tenant.getTenant(req.params.id))));
app.post('/api/assets/:id/tenant', scopeResource('assets'), manageMoney, h(async (req, res) => res.status(201).json(await tenant.setTenant(req.params.id, req.body))));
app.delete('/api/assets/:id/tenant', scopeResource('assets'), manageMoney, h(async (req, res) => res.json(await tenant.revokeTenant(req.params.id))));

// ---- document vault (agreements, bills, receipts — private S3) ------------
app.post('/api/assets/:id/documents', editAssets, scopeOwned('assets'), h(async (req, res) =>
  res.status(201).json(await documents.uploadDocument(req.params.id, req.body, req.user!.email))));
app.get('/api/assets/:id/documents', scopeResource('assets'), h(async (req, res) => res.json(await documents.listAssetDocuments(req.params.id))));
app.get('/api/work-orders/:id/documents', scopeResource('work_orders'), h(async (req, res) => res.json(await documents.listWorkOrderDocuments(req.params.id))));
app.get('/api/documents/:id/download', scopeVia('SELECT household_id FROM documents WHERE id = $1'), h(async (req, res) => {
  const f = await documents.getDocumentFile(req.params.id);
  res.setHeader('Content-Type', f.contentType);
  res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(f.filename)}"`);
  res.send(f.buffer);
}));
app.delete('/api/documents/:id', editAssets, scopeOwnedVia('SELECT d.household_id, a.member_id FROM documents d LEFT JOIN assets a ON a.id = d.asset_id WHERE d.id = $1'), h(async (req, res) => {
  await documents.deleteDocument(req.params.id);
  res.sendStatus(204);
}));

// ---- asset photos (member can manage their own asset's pictures) ----------
app.get('/api/assets/:id/photos', scopeResource('assets'), h(async (req, res) => res.json(await repo.listPhotos(req.params.id))));
app.post('/api/assets/:id/photos', editAssets, scopeOwned('assets'), h(async (req, res) => res.status(201).json(await repo.addPhoto(req.params.id, req.body))));
app.delete('/api/photos/:id', editAssets, scopeOwnedVia('SELECT a.household_id, a.member_id FROM asset_photos p JOIN assets a ON a.id = p.asset_id WHERE p.id = $1'), h(async (req, res) => { await repo.deletePhoto(req.params.id); res.sendStatus(204); }));

app.get('/api/assets/:id/contributions', scopeResource('assets'), h(async (req, res) => res.json(await repo.listContributions(req.params.id))));
app.post('/api/assets/:id/contributions', editOps, scopeResource('assets'), h(async (req, res) => {
  const c = await repo.addContribution(req.params.id, req.body);
  void funds.refreshFundValue(req.params.id); // keep a linked fund's value in step with its ledger
  res.status(201).json(c);
}));
app.post('/api/assets/:id/contributions/schedule', editOps, scopeResource('assets'), h(async (req, res) => {
  const r = await repo.addSipSchedule(req.params.id, req.body);
  void funds.refreshFundValue(req.params.id);
  res.status(201).json(r);
}));
app.delete('/api/contributions/:id', editOps, scopeVia('SELECT a.household_id FROM contributions c JOIN assets a ON a.id = c.asset_id WHERE c.id = $1'), h(async (req, res) => {
  const owner = await repo.deleteContribution(req.params.id); // returns the asset id
  if (owner) void funds.refreshFundValue(owner);
  res.sendStatus(204);
}));

// ---- loans (owner + manager) ---------------------------------------------
app.get('/api/households/:id/loans', sameHousehold, financialView, h(async (req, res) => res.json(await repo.listLoans(req.params.id))));
app.post('/api/households/:id/loans', sameHousehold, manageMoney, h(async (req, res) => res.status(201).json(await repo.createLoan(req.params.id, req.body))));
app.patch('/api/loans/:id', scopeResource('loans'), manageMoney, h(async (req, res) => res.json(await repo.updateLoan(req.params.id, req.body))));
app.delete('/api/loans/:id', scopeResource('loans'), manageMoney, h(async (req, res) => { await repo.deleteLoan(req.params.id); res.sendStatus(204); }));

// ---- personal loans given/taken (interest-bearing; fold into net worth) ----
app.get('/api/households/:id/personal-loans', sameHousehold, financialView, h(async (req, res) => res.json(await personalLoans.personalLoanSummary(req.params.id))));
app.post('/api/households/:id/personal-loans', sameHousehold, manageMoney, h(async (req, res) => res.status(201).json(await personalLoans.createPersonalLoan(req.params.id, req.body))));
app.patch('/api/personal-loans/:id', scopeResource('personal_loans'), manageMoney, h(async (req, res) => res.json(await personalLoans.updatePersonalLoan(req.params.id, req.body))));
app.delete('/api/personal-loans/:id', scopeResource('personal_loans'), manageMoney, h(async (req, res) => { await personalLoans.deletePersonalLoan(req.params.id); res.sendStatus(204); }));
app.get('/api/personal-loans/:id/payments', scopeResource('personal_loans'), financialView, h(async (req, res) => res.json(await personalLoans.listPayments(req.params.id))));
app.post('/api/personal-loans/:id/payments', scopeResource('personal_loans'), manageMoney, h(async (req, res) => res.status(201).json(await personalLoans.addPayment(req.params.id, req.body))));
app.delete('/api/personal-loan-payments/:id', scopeVia('SELECT household_id FROM personal_loan_payments WHERE id = $1'), manageMoney, h(async (req, res) => { await personalLoans.deletePayment(req.params.id); res.sendStatus(204); }));

// ---- operations: vendors --------------------------------------------------
app.get('/api/households/:id/vendors', sameHousehold, h(async (req, res) => res.json(await ops.listVendors(req.params.id))));
app.post('/api/households/:id/vendors', sameHousehold, editOps, h(async (req, res) => res.status(201).json(await ops.createVendor(req.params.id, req.body))));
app.patch('/api/vendors/:id', scopeResource('vendors'), editOps, h(async (req, res) => res.json(await ops.updateVendor(req.params.id, req.body))));
app.delete('/api/vendors/:id', scopeResource('vendors'), editOps, h(async (req, res) => { await ops.deleteVendor(req.params.id); res.sendStatus(204); }));

// ---- operations: work orders ---------------------------------------------
app.get('/api/households/:id/work-orders', sameHousehold, h(async (req, res) => res.json(await ops.listWorkOrders(req.params.id))));
app.post('/api/households/:id/work-orders', sameHousehold, editOps, h(async (req, res) => res.status(201).json(await ops.createWorkOrder(req.params.id, req.body))));
app.get('/api/work-orders/:id', scopeResource('work_orders'), h(async (req, res) => res.json(await ops.getWorkOrder(req.params.id))));
app.patch('/api/work-orders/:id', scopeResource('work_orders'), editOps, h(async (req, res) => res.json(await ops.updateWorkOrder(req.params.id, req.body))));
app.delete('/api/work-orders/:id', scopeResource('work_orders'), editOps, h(async (req, res) => { await ops.deleteWorkOrder(req.params.id); res.sendStatus(204); }));

// ---- operations: inspections & summary -----------------------------------
app.get('/api/households/:id/inspections', sameHousehold, h(async (req, res) => res.json(await ops.listInspections(req.params.id))));
app.post('/api/households/:id/inspections', sameHousehold, editOps, h(async (req, res) => res.status(201).json(await ops.createInspection(req.params.id, req.body))));
app.delete('/api/inspections/:id', scopeResource('inspections'), editOps, h(async (req, res) => { await ops.deleteInspection(req.params.id); res.sendStatus(204); }));
app.get('/api/households/:id/operations/summary', sameHousehold, h(async (req, res) => res.json(await ops.operationsSummary(req.params.id))));

// ---- rent roll (calendar-generated; owner/manager/operations collect) ----
app.get('/api/households/:id/rent', sameHousehold, h(async (req, res) => res.json(await rent.listRentCollections(req.params.id))));
app.get('/api/households/:id/rent/summary', sameHousehold, h(async (req, res) => res.json(await rent.rentSummary(req.params.id))));
app.get('/api/households/:id/rent/market-gap', sameHousehold, h(async (req, res) => res.json(await rent.rentMarketGap(req.params.id))));
app.get('/api/rent/:id/receipt', scopeResource('rent_collections'), h(async (req, res) => res.json(await rent.rentReceipt(req.params.id))));
app.post('/api/rent/:id/receipt/save', scopeResource('rent_collections'), editOps, h(async (req, res) => res.status(201).json(await rent.saveReceiptToVault(req.params.id))));
app.get('/api/assets/:id/receipts', scopeResource('assets'), h(async (req, res) => res.json(await rent.receiptsForYear(req.params.id, Number(req.query.fy)))));
app.post('/api/rent/:id/collect', scopeResource('rent_collections'), editOps, h(async (req, res) => res.json(await rent.collectRent(req.params.id, req.body))));
app.patch('/api/rent/:id', scopeResource('rent_collections'), editOps, h(async (req, res) => res.json(await rent.updateRent(req.params.id, req.body))));

// ---- family members (owner/manager manage the list; a member edits only self) --
app.get('/api/households/:id/members', sameHousehold, h(async (req, res) => {
  const list = await repo.listMembers(req.params.id);
  if (req.user!.role === 'operations') list.forEach((m: any) => { m.monthlyGross = null; m.monthlyTds = null; m.monthlyNet = null; m.monthlyExpenses = null; });
  res.json(list);
}));
app.post('/api/households/:id/members', sameHousehold, manageMoney, h(async (req, res) => res.status(201).json(await repo.createMember(req.params.id, req.body))));
app.patch('/api/members/:id', requireRole('owner', 'manager', 'member'), scopeResource('members'), memberSelfOnly, h(async (req, res) => res.json(await repo.updateMember(req.params.id, req.body))));
app.delete('/api/members/:id', scopeResource('members'), manageMoney, h(async (req, res) => { await repo.deleteMember(req.params.id); res.sendStatus(204); }));
app.get('/api/households/:id/members/assessment', sameHousehold, financialView, h(async (req, res) => res.json(await memberAssessments(req.params.id, new Date()))));

// ---- compliance calendar --------------------------------------------------
app.get('/api/households/:id/compliance', sameHousehold, h(async (req, res) => res.json(await compliance.listCompliance(req.params.id))));
app.get('/api/households/:id/compliance/summary', sameHousehold, h(async (req, res) => res.json(await compliance.complianceSummary(req.params.id))));
app.post('/api/households/:id/compliance', sameHousehold, editOps, h(async (req, res) => res.status(201).json(await compliance.createCompliance(req.params.id, req.body))));
app.patch('/api/compliance/:id', scopeResource('compliance_items'), editOps, h(async (req, res) => res.json(await compliance.updateCompliance(req.params.id, req.body))));
app.post('/api/compliance/:id/complete', scopeResource('compliance_items'), editOps, h(async (req, res) => res.json(await compliance.completeCompliance(req.params.id))));
app.delete('/api/compliance/:id', scopeResource('compliance_items'), editOps, h(async (req, res) => { await compliance.deleteCompliance(req.params.id); res.sendStatus(204); }));

// ---- approval workflow (operations propose → owner/manager decides) -------
const opsOrOwner = requireRole('owner', 'manager', 'operations');
app.get('/api/households/:id/approvals', sameHousehold, opsOrOwner, h(async (req, res) => res.json(await approvals.listApprovals(req.params.id, req.user!))));
app.get('/api/households/:id/approvals/summary', sameHousehold, manageMoney, h(async (req, res) => res.json(await approvals.approvalsSummary(req.params.id))));
app.post('/api/households/:id/approvals', sameHousehold, opsOrOwner, h(async (req, res) => res.status(201).json(await approvals.createApproval(req.params.id, req.user!, req.body))));
app.post('/api/approvals/:id/decide', scopeResource('approval_requests'), manageMoney, h(async (req, res) => res.json(await approvals.decideApproval(req.params.id, req.user!, req.body))));
app.delete('/api/approvals/:id', scopeResource('approval_requests'), manageMoney, h(async (req, res) => { await approvals.deleteApproval(req.params.id); res.sendStatus(204); }));

// ---- platform admin (app operator; counts only, no household money) -------
app.get('/api/admin/stats', auth.requireAdmin, h(async (_req, res) => res.json({ ...(await admin.platformStats()), signupsByWeek: await admin.signupsByWeek(), assetsByWeek: await admin.assetsByWeek() })));
app.get('/api/admin/users', auth.requireAdmin, h(async (_req, res) => res.json(await admin.listAllUsers())));
app.get('/api/admin/signins', auth.requireAdmin, h(async (_req, res) => res.json(await access.adminSignins())));
app.get('/api/admin/activity', auth.requireAdmin, h(async (_req, res) => res.json(await admin.recentActivity())));

// ---- audit trail (owner only — oversight) --------------------------------
app.get('/api/households/:id/audit', sameHousehold, ownerOnly, h(async (req, res) => res.json(await listAudit(req.params.id))));

// ---- team / access (owner only) ------------------------------------------
app.get('/api/households/:id/users', sameHousehold, ownerOnly, h(async (req, res) => res.json(await auth.listUsers(req.params.id))));
app.post('/api/households/:id/users', sameHousehold, ownerOnly, h(async (req, res) => res.status(201).json(await auth.createUser(req.params.id, req.body))));
app.delete('/api/users/:id', ownerOnly, h(async (req, res) => {
  if (req.params.id === req.user!.id) throw new HttpError(400, 'cannot_remove_self', "You can't remove your own access");
  await auth.deleteUser(req.params.id, req.user!.householdId);
  res.sendStatus(204);
}));
// Teammate password reset is email-only now — the owner triggers a reset link
// via POST /api/auth/forgot (public); no owner-typed passwords.

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
  // Compliance reminders: sweep on startup, then twice a day (the reminded_on
  // guard keeps it to one notification per item per day).
  const dailySweeps = () => { remindDueCompliance(); rent.generateRentDue(); ops.sweepFixedWorkOrders(); valuation.sweepValuations(); void repo.sweepSipContributions().then(() => funds.sweepFundValues()).catch(() => funds.sweepFundValues()); void funds.ensureDirectory(); history.sweepSnapshots(); access.purgeOldEvents(); };
  dailySweeps();
  setInterval(dailySweeps, 12 * 60 * 60 * 1000).unref();
}
