/**
 * Per-asset detail endpoint: engine-computed metrics (gain, equity/LTV, net
 * rent, DSCR) and the loans secured against the asset. Skips without DATABASE_URL.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import { app } from './index.ts';

const hasDb = !!process.env.DATABASE_URL;
const email = (p: string) => `${p}_${Date.now()}_${Math.random().toString(36).slice(2, 9)}@example.com`;

test('asset detail metrics', { skip: hasDb ? false : 'DATABASE_URL not set' }, async (t) => {
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
  try {
    const reg = await call('POST', '/api/auth/register', { email: email('owner'), password: 'secret123', monthlyTakeHome: 200000 });
    ownerTok = reg.body.token;
    householdId = reg.body.user.householdId;

    // A rented property bought at 60L, now worth 90L, rent 30k − 3k TDS, with a home loan.
    const flat = (await call('POST', `/api/households/${householdId}/assets`, {
      name: 'Rented flat', assetClass: 'real_estate', value: 9000000, costBasis: 6000000,
      acquiredYear: 2015, monthlyRent: 30000, rentTds: 3000,
    }, ownerTok)).body;
    await call('POST', `/api/households/${householdId}/loans`, {
      name: 'Home loan', outstanding: 4000000, emiMonthly: 40000, ratePct: 8.5, securedAssetId: flat.id,
    }, ownerTok);

    await t.test('property: gain, equity/LTV, net rent and DSCR', async () => {
      const d = (await call('GET', `/api/assets/${flat.id}/detail`, undefined, ownerTok)).body;
      const m = d.metrics;
      assert.equal(m.currentValue, 9000000);
      assert.equal(m.unrealizedGain, 3000000);          // 90L − 60L
      assert.ok(Math.abs(m.gainPct - 50) < 0.001);      // +50%
      assert.equal(m.securedOutstanding, 4000000);
      assert.equal(m.equity, 5000000);                  // 90L − 40L
      assert.ok(Math.abs(m.ltvPct - 44.444) < 0.1);
      assert.equal(m.netRentMonthly, 27000);            // 30k − 3k TDS
      assert.ok(Math.abs(m.dscr - 27000 / 40000) < 0.001);
      assert.equal(d.securedLoans.length, 1);
      assert.equal(d.securedLoans[0].name, 'Home loan');
      assert.ok(m.appreciationCagrPct > 0);             // has cost basis + year
    });

    await t.test('a fund with a dated contribution reports XIRR', async () => {
      const mf = (await call('POST', `/api/households/${householdId}/assets`, { name: 'Index fund', assetClass: 'mutual_fund', value: 200000, costBasis: 100000 }, ownerTok)).body;
      await call('POST', `/api/assets/${mf.id}/contributions`, { amount: 100000, on: '2022-01-01' }, ownerTok);
      const m = (await call('GET', `/api/assets/${mf.id}/detail`, undefined, ownerTok)).body.metrics;
      assert.equal(m.unrealizedGain, 100000);
      assert.ok(m.xirrPct != null && m.xirrPct > 0); // doubled over a few years
      assert.equal(m.dscr, null);                    // no loan
    });
  } finally {
    if (householdId) await call('DELETE', `/api/households/${householdId}`, undefined, ownerTok);
    await new Promise((r) => server.close(r));
  }
});
