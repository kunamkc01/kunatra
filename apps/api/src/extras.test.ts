/**
 * DSCR (rent), compliance calendar, and audit trail. Skips without DATABASE_URL.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import { app } from './index.ts';

const hasDb = !!process.env.DATABASE_URL;
const email = (p: string) => `${p}_${Date.now()}_${Math.random().toString(36).slice(2, 9)}@example.com`;
const iso = (d: Date) => d.toISOString().slice(0, 10);

test('DSCR, compliance & audit', { skip: hasDb ? false : 'DATABASE_URL not set' }, async (t) => {
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

  let ownerTok = '', opsTok = '', householdId = '';

  try {
    const reg = await call('POST', '/api/auth/register', { email: email('owner'), password: 'secret123', monthlyTakeHome: 150000 });
    ownerTok = reg.body.token;
    householdId = reg.body.user.householdId;

    await t.test('DSCR = rent ÷ EMI on a let property', async () => {
      const flat = (await call('POST', `/api/households/${householdId}/assets`,
        { name: 'Let flat', assetClass: 'real_estate', value: 10000000, liquid: false, monthlyRent: 40000 }, ownerTok)).body;
      await call('POST', `/api/households/${householdId}/loans`,
        { name: 'Home', outstanding: 6000000, emiMonthly: 50000, securedAssetId: flat.id }, ownerTok);
      const ex = (await call('GET', `/api/households/${householdId}/assessment`, undefined, ownerTok)).body.exposure;
      assert.equal(ex.monthlyRent, 40000);
      assert.ok(Math.abs(ex.dscr - 0.8) < 1e-9); // 40k / 50k
    });

    let itemId = '';
    await t.test('compliance: create, summary flags overdue, complete rolls forward', async () => {
      const past = iso(new Date(Date.now() - 5 * 86400000));
      itemId = (await call('POST', `/api/households/${householdId}/compliance`,
        { title: 'Property tax', kind: 'property_tax', dueOn: past, recurrence: 'yearly' }, ownerTok)).body.id;
      const sum = (await call('GET', `/api/households/${householdId}/compliance/summary`, undefined, ownerTok)).body;
      assert.equal(sum.overdue, 1);
      // Completing a yearly item advances the due date ~1 year out (no longer overdue).
      const done = (await call('POST', `/api/compliance/${itemId}/complete`, undefined, ownerTok)).body;
      assert.ok(done.item.dueOn > past);
      const sum2 = (await call('GET', `/api/households/${householdId}/compliance/summary`, undefined, ownerTok)).body;
      assert.equal(sum2.overdue, 0);
    });

    await t.test('operations can track compliance but a one-off completes away', async () => {
      // make ops user
      await call('POST', `/api/households/${householdId}/users`, { email: email('ops'), password: 'secret123', role: 'operations' }, ownerTok);
      const opsEmail = (await call('GET', `/api/households/${householdId}/users`, undefined, ownerTok)).body.find((u: any) => u.role === 'operations').email;
      opsTok = (await call('POST', '/api/auth/login', { email: opsEmail, password: 'secret123' })).body.token;
      const oneOff = (await call('POST', `/api/households/${householdId}/compliance`, { title: 'Fire NOC', dueOn: iso(new Date()), recurrence: 'none' }, opsTok)).body;
      const done = (await call('POST', `/api/compliance/${oneOff.id}/complete`, undefined, opsTok)).body;
      assert.equal(done.item, null); // one-off removed on completion
    });

    await t.test('audit trail records who changed what; operations cannot read it', async () => {
      const audit = (await call('GET', `/api/households/${householdId}/audit`, undefined, ownerTok)).body;
      assert.ok(audit.length >= 3);
      const assetEntry = audit.find((a: any) => a.entityType === 'asset' && a.action === 'created');
      assert.ok(assetEntry);
      assert.ok(assetEntry.actorEmail.includes('owner'));
      // an ops-created compliance item should be attributed to the ops user
      assert.ok(audit.some((a: any) => a.entityType === 'compliance item' && a.actorRole === 'operations'));
      // operations can't see the audit trail
      assert.equal((await call('GET', `/api/households/${householdId}/audit`, undefined, opsTok)).status, 403);
    });
  } finally {
    if (householdId) await call('DELETE', `/api/households/${householdId}`, undefined, ownerTok);
    await new Promise((r) => server.close(r));
  }
});
