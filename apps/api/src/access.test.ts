/**
 * Advisor (read-only) role and the approval workflow. Skips without DATABASE_URL.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import { app } from './index.ts';

const hasDb = !!process.env.DATABASE_URL;
const email = (p: string) => `${p}_${Date.now()}_${Math.random().toString(36).slice(2, 9)}@example.com`;

test('advisor role & approvals', { skip: hasDb ? false : 'DATABASE_URL not set' }, async (t) => {
  const server = app.listen(0);
  await new Promise((r) => server.once('listening', r));
  const base = `http://localhost:${(server.address() as AddressInfo).port}`;

  const call = async (method: string, path: string, body?: unknown, token?: string) => {
    const res = await fetch(`${base}${path}`, {
      method, headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await res.text();
    return { status: res.status, body: text ? JSON.parse(text) : undefined };
  };

  let ownerTok = '', advisorTok = '', opsTok = '', householdId = '';

  try {
    const reg = await call('POST', '/api/auth/register', { email: email('owner'), password: 'secret123', monthlyTakeHome: 200000 });
    ownerTok = reg.body.token;
    householdId = reg.body.user.householdId;

    await t.test('owner can add an advisor and an operations teammate', async () => {
      const advEmail = email('advisor'); const opsEmail = email('ops');
      assert.equal((await call('POST', `/api/households/${householdId}/users`, { email: advEmail, password: 'secret123', role: 'advisor' }, ownerTok)).status, 201);
      assert.equal((await call('POST', `/api/households/${householdId}/users`, { email: opsEmail, password: 'secret123', role: 'operations' }, ownerTok)).status, 201);
      advisorTok = (await call('POST', '/api/auth/login', { email: advEmail, password: 'secret123' })).body.token;
      opsTok = (await call('POST', '/api/auth/login', { email: opsEmail, password: 'secret123' })).body.token;
    });

    await t.test('advisor sees the financial picture (unlike operations)', async () => {
      const a = await call('GET', `/api/households/${householdId}/assessment`, undefined, advisorTok);
      assert.equal(a.status, 200);
      assert.equal(a.body.income.total, 200000); // advisor sees the money (salary lives on the person now)
      assert.equal((await call('GET', `/api/households/${householdId}/assessment`, undefined, opsTok)).status, 403); // operations do not
      const members = (await call('GET', `/api/households/${householdId}/members`, undefined, opsTok)).body;
      assert.ok(members.every((m: any) => m.monthlyNet == null)); // and incomes are masked for them
    });

    await t.test('advisor is read-only (cannot change anything)', async () => {
      assert.equal((await call('POST', `/api/households/${householdId}/assets`, { name: 'x', assetClass: 'cash', value: 100 }, advisorTok)).status, 403);
      assert.equal((await call('POST', `/api/households/${householdId}/work-orders`, { title: 'x' }, advisorTok)).status, 403);
      // and can't see the oversight log or manage the team
      assert.equal((await call('GET', `/api/households/${householdId}/audit`, undefined, advisorTok)).status, 403);
    });

    let reqId = '';
    await t.test('operations raises a request; owner sees it pending', async () => {
      const r = await call('POST', `/api/households/${householdId}/approvals`, { title: 'Replace water pump', amount: 18000, note: 'quote from vendor' }, opsTok);
      assert.equal(r.status, 201);
      assert.equal(r.body.status, 'pending');
      reqId = r.body.id;
      const summary = (await call('GET', `/api/households/${householdId}/approvals/summary`, undefined, ownerTok)).body;
      assert.equal(summary.pending, 1);
      const opsView = (await call('GET', `/api/households/${householdId}/approvals`, undefined, opsTok)).body;
      assert.equal(opsView.length, 1); // ops sees their own
    });

    await t.test('operations cannot decide; owner approves', async () => {
      assert.equal((await call('POST', `/api/approvals/${reqId}/decide`, { decision: 'approved' }, opsTok)).status, 403);
      const dec = await call('POST', `/api/approvals/${reqId}/decide`, { decision: 'approved', note: 'go ahead' }, ownerTok);
      assert.equal(dec.status, 200);
      assert.equal(dec.body.status, 'approved');
      assert.ok(dec.body.decidedBy.includes('owner'));
      // deciding again fails — no longer pending
      assert.equal((await call('POST', `/api/approvals/${reqId}/decide`, { decision: 'rejected' }, ownerTok)).status, 409);
    });

    await t.test('advisor cannot use the approval workflow', async () => {
      assert.equal((await call('POST', `/api/households/${householdId}/approvals`, { title: 'x' }, advisorTok)).status, 403);
      assert.equal((await call('GET', `/api/households/${householdId}/approvals`, undefined, advisorTok)).status, 403);
    });
  } finally {
    if (householdId) await call('DELETE', `/api/households/${householdId}`, undefined, ownerTok);
    await new Promise((r) => server.close(r));
  }
});
