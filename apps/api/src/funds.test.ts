/**
 * Mutual-fund NAV valuation: units × latest NAV from dated contributions,
 * auto-setting the asset value. NAV provider is faked (no network). The pure
 * navOnOrBefore lookup is tested directly. Skips without DATABASE_URL.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import { app } from './index.ts';
import { _setFundProvidersForTests, navOnOrBefore, type NavPoint } from './funds.ts';

const hasDb = !!process.env.DATABASE_URL;
const email = (p: string) => `${p}_${Date.now()}_${Math.random().toString(36).slice(2, 9)}@example.com`;

// NAV 10 (2020) → 15 (2023) → 20 (2026, latest)
const HIST: NavPoint[] = [
  { date: '2020-01-01', nav: 10 },
  { date: '2023-01-01', nav: 15 },
  { date: '2026-07-01', nav: 20 },
];

test('navOnOrBefore picks the nearest earlier trading day (pure)', () => {
  assert.equal(navOnOrBefore(HIST, '2020-01-01'), 10);
  assert.equal(navOnOrBefore(HIST, '2022-06-15'), 10);  // holiday/gap → prior
  assert.equal(navOnOrBefore(HIST, '2023-01-01'), 15);
  assert.equal(navOnOrBefore(HIST, '2030-01-01'), 20);  // after latest → latest
  assert.equal(navOnOrBefore(HIST, '2019-01-01'), 10);  // before first → earliest
});

test('fund valuation: units × latest NAV, auto-set', { skip: hasDb ? false : 'DATABASE_URL not set' }, async (t) => {
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

  let tok = '', hh = '';
  try {
    _setFundProvidersForTests(async () => HIST, async () => [{ schemeCode: 122639, schemeName: 'Test Flexi Cap - Direct - Growth' }]);
    const reg = await call('POST', '/api/auth/register', { email: email('fund'), password: 'secret123', fullName: 'Fund Owner' });
    tok = reg.body.token; hh = reg.body.user.householdId;

    await t.test('search proxies scheme names', async () => {
      const r = await call('GET', `/api/funds/search?q=flexi cap`, undefined, tok);
      assert.equal(r.body[0].schemeCode, 122639);
    });

    let assetId = '';
    await t.test('lump: ₹1,00,000 in 2020 → 10,000 units → ₹2,00,000 today', async () => {
      const a = await call('POST', `/api/households/${hh}/assets`, { name: 'Flexi Cap', assetClass: 'mutual_fund', value: 111111 }, tok);
      assetId = a.body.id;
      await call('POST', `/api/assets/${assetId}/contributions`, { amount: 100000, on: '2020-01-01' }, tok);
      const f = await call('POST', `/api/assets/${assetId}/fund`, { schemeCode: '122639', schemeName: 'Test Flexi Cap - Direct - Growth' }, tok);
      assert.equal(f.status, 200);
      assert.equal(f.body.units, 10000);           // 100000 / 10
      assert.equal(f.body.currentValue, 200000);   // 10000 × 20
      assert.equal(f.body.latestNav, 20);
      // the asset's value was auto-set to the computed value
      const asset = (await call('GET', `/api/assets/${assetId}`, undefined, tok)).body;
      assert.equal(asset.value, 200000);
    });

    await t.test('SIP: two dated buys accumulate units at each date’s NAV', async () => {
      const a = await call('POST', `/api/households/${hh}/assets`, { name: 'SIP fund', assetClass: 'sip', value: 1 }, tok);
      const id = a.body.id;
      await call('POST', `/api/assets/${id}/contributions`, { amount: 60000, on: '2020-06-01' }, tok);   // nav 10 → 6000u
      await call('POST', `/api/assets/${id}/contributions`, { amount: 60000, on: '2023-06-01' }, tok);   // nav 15 → 4000u
      const f = await call('POST', `/api/assets/${id}/fund`, { schemeCode: '122639' }, tok);
      assert.equal(f.body.units, 10000);            // 6000 + 4000
      assert.equal(f.body.currentValue, 200000);    // 10000 × 20
      assert.equal(f.body.invested, 120000);
    });

    await t.test('no investment dates → clear 422, not a bogus value', async () => {
      const a = await call('POST', `/api/households/${hh}/assets`, { name: 'Bare fund', assetClass: 'mutual_fund', value: 50000 }, tok);
      const f = await call('POST', `/api/assets/${a.body.id}/fund`, { schemeCode: '122639' }, tok);
      assert.equal(f.status, 422);
    });

    await t.test('non-fund asset is rejected', async () => {
      const a = await call('POST', `/api/households/${hh}/assets`, { name: 'Gold', assetClass: 'gold', value: 100000 }, tok);
      const f = await call('POST', `/api/assets/${a.body.id}/fund`, { schemeCode: '122639' }, tok);
      assert.equal(f.status, 400);
    });

    await t.test('unlink stops auto-valuation', async () => {
      await call('DELETE', `/api/assets/${assetId}/fund`, undefined, tok);
      const g = await call('GET', `/api/assets/${assetId}/fund`, undefined, tok);
      assert.equal(g.body, null);
    });
  } finally {
    _setFundProvidersForTests(null, null);
    if (hh) await call('DELETE', `/api/households/${hh}`, undefined, tok);
    await new Promise((r) => server.close(r));
  }
});
