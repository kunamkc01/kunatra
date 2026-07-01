/**
 * Investments: cost basis / appreciation, recurring contributions, valuations,
 * and the new asset classes. Skips if DATABASE_URL is unset.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import { app } from './index.ts';

const hasDb = !!process.env.DATABASE_URL;
const email = () => `inv_${Date.now()}_${Math.random().toString(36).slice(2, 9)}@example.com`;

test('investments & appreciation', { skip: hasDb ? false : 'DATABASE_URL not set' }, async (t) => {
  const server = app.listen(0);
  await new Promise((r) => server.once('listening', r));
  const base = `http://localhost:${(server.address() as AddressInfo).port}`;

  let token = '';
  const call = async (method: string, path: string, body?: unknown) => {
    const res = await fetch(`${base}${path}`, {
      method,
      headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await res.text();
    return { status: res.status, body: text ? JSON.parse(text) : undefined };
  };

  let householdId = '', assetId = '';

  try {
    const reg = (await call('POST', '/api/auth/register', { email: email(), password: 'secret123', monthlyTakeHome: 150000 })).body;
    token = reg.token; householdId = reg.user.householdId;

    await t.test('creates a SIP asset with cost basis + monthly contribution', async () => {
      const { status, body } = await call('POST', `/api/households/${householdId}/assets`, {
        name: 'Index fund SIP', assetClass: 'sip', value: 500000, liquid: true, costBasis: 400000, monthlyContribution: 15000,
      });
      assert.equal(status, 201);
      assert.equal(body.costBasis, 400000);
      assert.equal(body.monthlyContribution, 15000);
      assetId = body.id;
    });

    await t.test('accepts new investment classes (fd, nps)', async () => {
      assert.equal((await call('POST', `/api/households/${householdId}/assets`, { name: 'Bank FD', assetClass: 'fd', value: 200000 })).status, 201);
      assert.equal((await call('POST', `/api/households/${householdId}/assets`, { name: 'NPS', assetClass: 'nps', value: 300000, costBasis: 250000, monthlyContribution: 5000 })).status, 201);
    });

    await t.test('assessment derives unrealized gain and monthly investing', async () => {
      const inv = (await call('GET', `/api/households/${householdId}/assessment`)).body.investments;
      assert.equal(inv.invested, 650000);        // 400k + 250k
      assert.equal(inv.currentValue, 800000);     // 500k + 300k
      assert.equal(inv.unrealizedGain, 150000);
      assert.equal(Math.round(inv.gainPct), 23);  // 150k / 650k
      assert.equal(inv.monthlyContribution, 20000); // 15k + 5k
      assert.equal(inv.contributingCount, 2);
    });

    await t.test('emits appreciation + savings-rate signals (descriptive)', async () => {
      const signals = (await call('GET', `/api/households/${householdId}/assessment`)).body.signals;
      const app = signals.find((s: any) => s.key === 'appreciation');
      const sav = signals.find((s: any) => s.key === 'savings_rate');
      assert.ok(app && app.value > 0);
      assert.equal(sav.display, '13%'); // 20k / 150k
      for (const s of signals) assert.doesNotMatch(s.message, /should|must|buy|sell/i);
    });

    await t.test('a later valuation becomes the current value', async () => {
      assert.equal((await call('POST', `/api/assets/${assetId}/valuations`, { value: 550000, asOf: '2026-06-01', source: 'NAV' })).status, 201);
      assert.equal((await call('GET', `/api/assets/${assetId}`)).body.value, 550000);
      // An older valuation does not override the latest.
      await call('POST', `/api/assets/${assetId}/valuations`, { value: 480000, asOf: '2026-01-01' });
      assert.equal((await call('GET', `/api/assets/${assetId}`)).body.value, 550000);
    });

    await t.test('valuation history lists newest first', async () => {
      const vals = (await call('GET', `/api/assets/${assetId}/valuations`)).body;
      assert.equal(vals.length, 2);
      assert.equal(vals[0].asOf, '2026-06-01');
    });

    await t.test('deleting the latest valuation falls back to the previous', async () => {
      const vals = (await call('GET', `/api/assets/${assetId}/valuations`)).body;
      const june = vals.find((v: any) => v.asOf === '2026-06-01');
      assert.equal((await call('DELETE', `/api/valuations/${june.id}`)).status, 204);
      assert.equal((await call('GET', `/api/assets/${assetId}`)).body.value, 480000);
    });
  } finally {
    if (householdId) await call('DELETE', `/api/households/${householdId}`);
    await new Promise((r) => server.close(r));
  }
});
