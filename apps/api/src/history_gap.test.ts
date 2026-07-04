/**
 * Net-worth history snapshots (month-bucket upsert) and the rent-vs-market gap.
 * Skips without DATABASE_URL.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import { app } from './index.ts';
import { snapshotHousehold } from './history.ts';
import { _setProviderForTests } from './valuation.ts';

const hasDb = !!process.env.DATABASE_URL;
const email = (p: string) => `${p}_${Date.now()}_${Math.random().toString(36).slice(2, 9)}@example.com`;

const ESTIMATE = JSON.stringify({
  estimatedValue: 9500000, lowValue: 8500000, highValue: 10500000,
  pricePerSqft: 6500, estimatedMonthlyRent: 32000, rentalYieldPct: 4,
  annualGrowthPct: 6, confidence: 'medium', summary: 'ok', reasons: ['band'],
});

test('net-worth history & rent-vs-market gap', { skip: hasDb ? false : 'DATABASE_URL not set' }, async (t) => {
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
    _setProviderForTests(async () => ESTIMATE);
    const reg = await call('POST', '/api/auth/register', { email: email('owner'), password: 'secret123', monthlyTakeHome: 100000 });
    ownerTok = reg.body.token; householdId = reg.body.user.householdId;

    await t.test('empty household: nothing to snapshot', async () => {
      assert.equal(await snapshotHousehold(householdId), false);
      const h = (await call('GET', `/api/households/${householdId}/networth-history`, undefined, ownerTok)).body;
      assert.equal(h.length, 0);
    });

    let assetId = '';
    await t.test('snapshot captures the position; same-month reruns upsert', async () => {
      const a = await call('POST', `/api/households/${householdId}/assets`,
        { name: 'Flat', assetClass: 'real_estate', value: 9000000, monthlyRent: 25000 }, ownerTok);
      assetId = a.body.id;
      await call('POST', `/api/households/${householdId}/loans`, { name: 'Home', outstanding: 4000000, emiMonthly: 40000 }, ownerTok);

      assert.equal(await snapshotHousehold(householdId), true);
      let h = (await call('GET', `/api/households/${householdId}/networth-history`, undefined, ownerTok)).body;
      assert.equal(h.length, 1);
      assert.equal(h[0].netWorth, 5000000);          // 90L − 40L
      assert.equal(h[0].grossAssets, 9000000);
      assert.equal(h[0].byClass.real_estate, 9000000);

      // value changes + re-snapshot in the same month → still ONE row, updated
      await call('PATCH', `/api/assets/${assetId}`, { value: 9500000 }, ownerTok);
      assert.equal(await snapshotHousehold(householdId), true);
      h = (await call('GET', `/api/households/${householdId}/networth-history`, undefined, ownerTok)).body;
      assert.equal(h.length, 1);
      assert.equal(h[0].netWorth, 5500000);
    });

    await t.test('rent gap compares actual rent to the AI market estimate', async () => {
      // wait for the estimate the asset-create queued (fake provider: rent est 32k)
      for (let i = 0; i < 40; i++) {
        const v = (await call('GET', `/api/assets/${assetId}/valuation`, undefined, ownerTok)).body;
        if (v && v.status === 'ok') break;
        await new Promise((r) => setTimeout(r, 100));
      }
      const g = (await call('GET', `/api/households/${householdId}/rent/market-gap`, undefined, ownerTok)).body;
      assert.equal(g.comparedCount, 1);
      assert.equal(g.underMarketCount, 1);
      assert.equal(g.items[0].actualRent, 25000);
      assert.equal(g.items[0].marketRent, 32000);
      assert.equal(g.items[0].gapMonthly, 7000);
      assert.equal(g.totalYearlyGap, 84000);         // the "left on the table" rollup
    });

    await t.test('properties without rent or estimate are excluded', async () => {
      await call('POST', `/api/households/${householdId}/assets`, { name: 'Own home', assetClass: 'real_estate', value: 5000000 }, ownerTok);
      const g = (await call('GET', `/api/households/${householdId}/rent/market-gap`, undefined, ownerTok)).body;
      assert.equal(g.comparedCount, 1); // still just the rented one
    });
  } finally {
    _setProviderForTests(null);
    if (householdId) await call('DELETE', `/api/households/${householdId}`, undefined, ownerTok);
    await new Promise((r) => server.close(r));
  }
});
