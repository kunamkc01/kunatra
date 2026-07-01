/**
 * Auth & role-based access tests. Skips if DATABASE_URL is unset.
 * Verifies: registration/login, owner vs operations permissions, financial masking,
 * and cross-household isolation.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import { app } from './index.ts';

const hasDb = !!process.env.DATABASE_URL;
const email = (p: string) => `${p}_${Date.now()}_${Math.random().toString(36).slice(2, 9)}@example.com`;

test('auth & roles', { skip: hasDb ? false : 'DATABASE_URL not set' }, async (t) => {
  const server = app.listen(0);
  await new Promise((r) => server.once('listening', r));
  const base = `http://localhost:${(server.address() as AddressInfo).port}`;

  const call = async (method: string, path: string, body?: unknown, token?: string) => {
    const res = await fetch(`${base}${path}`, {
      method,
      headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await res.text();
    return { status: res.status, body: text ? JSON.parse(text) : undefined };
  };

  let ownerTok = '', opsTok = '', householdId = '', otherHouseholdId = '', otherTok = '';
  const ownerEmail = email('owner');

  try {
    await t.test('register owner + login', async () => {
      const reg = await call('POST', '/api/auth/register', { email: ownerEmail, password: 'secret123', householdName: 'Fam' });
      assert.equal(reg.status, 201);
      ownerTok = reg.body.token;
      householdId = reg.body.user.householdId;

      const bad = await call('POST', '/api/auth/login', { email: ownerEmail, password: 'wrong' });
      assert.equal(bad.status, 401);
      const ok = await call('POST', '/api/auth/login', { email: ownerEmail, password: 'secret123' });
      assert.equal(ok.status, 200);
      assert.ok(ok.body.token);
    });

    await t.test('duplicate email is rejected (409)', async () => {
      const dup = await call('POST', '/api/auth/register', { email: ownerEmail, password: 'secret123' });
      assert.equal(dup.status, 409);
    });

    await t.test('owner adds an operations teammate', async () => {
      const opsEmail = email('ops');
      const { status } = await call('POST', `/api/households/${householdId}/users`,
        { email: opsEmail, password: 'secret123', fullName: 'Ops Person', role: 'operations' }, ownerTok);
      assert.equal(status, 201);
      opsTok = (await call('POST', '/api/auth/login', { email: opsEmail, password: 'secret123' })).body.token;
    });

    await t.test('/me returns the caller', async () => {
      const me = await call('GET', '/api/auth/me', undefined, opsTok);
      assert.equal(me.body.role, 'operations');
    });

    await t.test('operations CAN use assets and work orders', async () => {
      const asset = await call('POST', `/api/households/${householdId}/assets`,
        { name: 'Villa', assetClass: 'real_estate', value: 8000000, liquid: false }, opsTok);
      assert.equal(asset.status, 201);
      const wo = await call('POST', `/api/households/${householdId}/work-orders`,
        { title: 'Fix gate', category: 'repair' }, opsTok);
      assert.equal(wo.status, 201);
    });

    await t.test('operations CANNOT see the assessment (403)', async () => {
      const { status } = await call('GET', `/api/households/${householdId}/assessment`, undefined, opsTok);
      assert.equal(status, 403);
    });

    await t.test('operations CANNOT touch loans (403)', async () => {
      const { status } = await call('POST', `/api/households/${householdId}/loans`,
        { name: 'x', outstanding: 1, emiMonthly: 1 }, opsTok);
      assert.equal(status, 403);
    });

    await t.test('operations CANNOT manage the team (403)', async () => {
      const { status } = await call('GET', `/api/households/${householdId}/users`, undefined, opsTok);
      assert.equal(status, 403);
    });

    await t.test('operations sees the household with financials masked', async () => {
      const owner = await call('GET', `/api/households/${householdId}`, undefined, ownerTok);
      const ops = await call('GET', `/api/households/${householdId}`, undefined, opsTok);
      assert.equal(ops.body.displayName, owner.body.displayName);
      assert.equal(ops.body.monthlyTakeHome, null); // hidden
    });

    await t.test('cross-household access is blocked (403)', async () => {
      const reg = await call('POST', '/api/auth/register', { email: email('other'), password: 'secret123' });
      otherTok = reg.body.token;
      otherHouseholdId = reg.body.user.householdId;
      // other owner tries to read the first household
      const cross = await call('GET', `/api/households/${householdId}/assets`, undefined, otherTok);
      assert.equal(cross.status, 403);
    });
  } finally {
    if (householdId) await call('DELETE', `/api/households/${householdId}`, undefined, ownerTok);
    if (otherHouseholdId) await call('DELETE', `/api/households/${otherHouseholdId}`, undefined, otherTok);
    await new Promise((r) => server.close(r));
  }
});
