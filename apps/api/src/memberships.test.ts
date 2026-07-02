/**
 * Multi-household memberships: the manager role (manages the money, not the team),
 * the member role (own salary & assets only, household read-only), and switching
 * between the households one login belongs to. Skips without DATABASE_URL.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import { app } from './index.ts';

const hasDb = !!process.env.DATABASE_URL;
const email = (p: string) => `${p}_${Date.now()}_${Math.random().toString(36).slice(2, 9)}@example.com`;

test('memberships: manager, member & household switch', { skip: hasDb ? false : 'DATABASE_URL not set' }, async (t) => {
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

  let ownerTok = '', householdId = '';
  let sisTok = '', sisHousehold = '';
  const wifeEmail = email('wife'), managerEmail = email('me');

  try {
    // --- household A: the owner, with two people on it ---
    const reg = await call('POST', '/api/auth/register', { email: email('owner'), password: 'secret123', monthlyTakeHome: 200000 });
    ownerTok = reg.body.token;
    householdId = reg.body.user.householdId;

    const wife = (await call('POST', `/api/households/${householdId}/members`, { name: 'Wife', monthlyGross: 90000 }, ownerTok)).body;
    const husband = (await call('POST', `/api/households/${householdId}/members`, { name: 'Husband', monthlyGross: 120000 }, ownerTok)).body;

    await t.test('a member login must be linked to a person', async () => {
      const bad = await call('POST', `/api/households/${householdId}/users`, { email: email('x'), password: 'secret123', role: 'member' }, ownerTok);
      assert.equal(bad.status, 400);
    });

    let wifeTok = '';
    await t.test('owner grants the wife member access to her own person', async () => {
      const r = await call('POST', `/api/households/${householdId}/users`, { email: wifeEmail, password: 'secret123', role: 'member', memberId: wife.id }, ownerTok);
      assert.equal(r.status, 201);
      wifeTok = (await call('POST', '/api/auth/login', { email: wifeEmail, password: 'secret123' })).body.token;
    });

    await t.test('member sees the household read-only but not the team/audit', async () => {
      assert.equal((await call('GET', `/api/households/${householdId}/assessment`, undefined, wifeTok)).status, 200); // household view
      assert.equal((await call('GET', `/api/households/${householdId}/audit`, undefined, wifeTok)).status, 403);       // not oversight
      assert.equal((await call('GET', `/api/households/${householdId}/users`, undefined, wifeTok)).status, 403);       // not the team
      assert.equal((await call('POST', `/api/households/${householdId}/loans`, { name: 'x', outstanding: 1, emiMonthly: 1 }, wifeTok)).status, 403); // not the money
    });

    let wifeAssetId = '', husbandAssetId = '';
    await t.test("member's new assets are forced to their own person", async () => {
      // even if she claims the husband's memberId, the server overrides it to her own
      const a = await call('POST', `/api/households/${householdId}/assets`, { name: 'Wife SIP', assetClass: 'sip', value: 50000, memberId: husband.id }, wifeTok);
      assert.equal(a.status, 201);
      assert.equal(a.body.memberId, wife.id);
      wifeAssetId = a.body.id;
      // owner adds an asset for the husband
      const h = await call('POST', `/api/households/${householdId}/assets`, { name: 'Husband FD', assetClass: 'fd', value: 300000, memberId: husband.id }, ownerTok);
      husbandAssetId = h.body.id;
    });

    await t.test('member can edit/delete only their own items', async () => {
      assert.equal((await call('PATCH', `/api/assets/${wifeAssetId}`, { value: 60000 }, wifeTok)).status, 200);
      assert.equal((await call('PATCH', `/api/assets/${husbandAssetId}`, { value: 1 }, wifeTok)).status, 403);
      assert.equal((await call('DELETE', `/api/assets/${husbandAssetId}`, undefined, wifeTok)).status, 403);
      // and only her own person record
      assert.equal((await call('PATCH', `/api/members/${wife.id}`, { monthlyGross: 95000 }, wifeTok)).status, 200);
      assert.equal((await call('PATCH', `/api/members/${husband.id}`, { monthlyGross: 1 }, wifeTok)).status, 403);
    });

    // --- household B: the sister's, where the owner is a manager ("authorized") ---
    const sisReg = await call('POST', '/api/auth/register', { email: email('sister'), password: 'secret123', monthlyTakeHome: 80000 });
    sisTok = sisReg.body.token;
    sisHousehold = sisReg.body.user.householdId;

    await t.test('sister adds the owner as a manager of her household', async () => {
      const ownerEmail = reg.body.user.email;
      const r = await call('POST', `/api/households/${sisHousehold}/users`, { email: ownerEmail, role: 'manager' }, sisTok);
      assert.equal(r.status, 201); // existing account → just a new membership, no password needed
    });

    await t.test('the login now spans two households', async () => {
      const me = (await call('GET', '/api/auth/me', undefined, ownerTok)).body;
      assert.equal(me.households.length, 2);
      assert.ok(me.households.some((h: any) => h.householdId === sisHousehold && h.role === 'manager'));
    });

    let sisManagerTok = '';
    await t.test('switching households returns a token scoped to that role', async () => {
      const sw = await call('POST', '/api/auth/switch', { householdId: sisHousehold }, ownerTok);
      assert.equal(sw.status, 200);
      assert.equal(sw.body.user.householdId, sisHousehold);
      assert.equal(sw.body.user.role, 'manager');
      sisManagerTok = sw.body.token;
    });

    await t.test('as manager the owner manages the sister\'s money but not her team', async () => {
      assert.equal((await call('POST', `/api/households/${sisHousehold}/loans`, { name: 'Car', outstanding: 400000, emiMonthly: 12000 }, sisManagerTok)).status, 201);
      assert.equal((await call('GET', `/api/households/${sisHousehold}/assessment`, undefined, sisManagerTok)).status, 200);
      // manager cannot manage the team or delete the household
      assert.equal((await call('POST', `/api/households/${sisHousehold}/users`, { email: email('z'), password: 'secret123', role: 'operations' }, sisManagerTok)).status, 403);
      assert.equal((await call('DELETE', `/api/households/${sisHousehold}`, undefined, sisManagerTok)).status, 403);
      assert.equal((await call('GET', `/api/households/${sisHousehold}/audit`, undefined, sisManagerTok)).status, 403);
    });

    await t.test('cannot switch into a household you are not a member of', async () => {
      // the wife's login has no access to the sister's household
      const wifeTok2 = (await call('POST', '/api/auth/login', { email: wifeEmail, password: 'secret123' })).body.token;
      assert.equal((await call('POST', '/api/auth/switch', { householdId: sisHousehold }, wifeTok2)).status, 403);
      assert.equal((await call('GET', `/api/households/${sisHousehold}/assessment`, undefined, wifeTok2)).status, 403);
    });

    await t.test('removing access revokes the membership but keeps the account', async () => {
      const users = (await call('GET', `/api/households/${sisHousehold}/users`, undefined, sisTok)).body;
      const mgr = users.find((u: any) => u.role === 'manager');
      assert.equal((await call('DELETE', `/api/users/${mgr.id}`, undefined, sisTok)).status, 204);
      // the account still works in its own household
      const me = (await call('GET', '/api/auth/me', undefined, ownerTok)).body;
      assert.equal(me.households.length, 1);
    });

    await t.test('anyone can create their own household and owns it', async () => {
      // the wife (a member of the first household) spins up her own
      const wifeTok3 = (await call('POST', '/api/auth/login', { email: wifeEmail, password: 'secret123' })).body.token;
      const before = (await call('GET', '/api/auth/me', undefined, wifeTok3)).body.households.length;
      const created = await call('POST', '/api/households', { displayName: 'Her own place' }, wifeTok3);
      assert.equal(created.status, 201);
      assert.equal(created.body.user.role, 'owner');            // owner of the new one
      assert.equal(created.body.user.households.length, before + 1);
      const newHh = created.body.user.householdId;
      const newTok = created.body.token;
      // and as owner she can add a property there
      assert.equal((await call('POST', `/api/households/${newHh}/assets`, { name: 'Her flat', assetClass: 'real_estate', value: 4000000 }, newTok)).status, 201);
      await call('DELETE', `/api/households/${newHh}`, undefined, newTok);
    });
  } finally {
    if (sisHousehold) await call('DELETE', `/api/households/${sisHousehold}`, undefined, sisTok);
    if (householdId) await call('DELETE', `/api/households/${householdId}`, undefined, ownerTok);
    await new Promise((r) => server.close(r));
  }
});
