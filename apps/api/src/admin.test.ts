/**
 * Platform admin view: the count/list functions, and that the endpoints are
 * admin-only (a normal user is forbidden). Skips without DATABASE_URL.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import { app } from './index.ts';
import { platformStats, listAllUsers } from './admin.ts';

const hasDb = !!process.env.DATABASE_URL;
const email = (p: string) => `${p}_${Date.now()}_${Math.random().toString(36).slice(2, 9)}@example.com`;

test('platform admin view', { skip: hasDb ? false : 'DATABASE_URL not set' }, async (t) => {
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

  let ownerTok = '', householdId = '', ownerEmail = email('user');
  try {
    const reg = await call('POST', '/api/auth/register', { email: ownerEmail, password: 'secret123' });
    ownerTok = reg.body.token; householdId = reg.body.user.householdId;

    await t.test('stats count identities, not money', async () => {
      await call('POST', `/api/households/${householdId}/assets`, { name: 'Flat', assetClass: 'real_estate', value: 5000000 }, ownerTok);
      const s = await platformStats();
      // Global counts (other test files run in parallel) — assert shape + minimums,
      // not exact deltas.
      assert.ok(typeof s.users === 'number' && s.users >= 1);
      assert.ok(s.households >= 1 && s.assets >= 1 && s.properties >= 1);
      // sanity: it's just counts — no money keys leak in
      assert.ok(!('netWorth' in s) && !('value' in s) && !('paise' in s));
    });

    await t.test('the user list includes the account (identity only)', async () => {
      const users = await listAllUsers();
      const mine = users.find((u) => u.email === ownerEmail);
      assert.ok(mine);
      assert.equal(mine!.householdCount, 1);
      assert.ok(Array.isArray(mine!.roles));
      assert.ok(!('assets' in mine!) && !('netWorth' in mine!)); // no holdings
    });

    await t.test('admin endpoints are forbidden to a normal user', async () => {
      // ADMIN_EMAILS is unset in tests, so nobody is an admin.
      assert.equal((await call('GET', '/api/admin/stats', undefined, ownerTok)).status, 403);
      assert.equal((await call('GET', '/api/admin/users', undefined, ownerTok)).status, 403);
      assert.equal(reg.body.user.isAdmin, false); // me() reports non-admin
    });
  } finally {
    if (householdId) await call('DELETE', `/api/households/${householdId}`, undefined, ownerTok);
    await new Promise((r) => server.close(r));
  }
});
