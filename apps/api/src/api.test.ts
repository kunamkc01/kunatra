/**
 * API integration tests. Exercise the real Express app against Postgres.
 * Run: node --env-file=.env --experimental-strip-types --test src/api.test.ts
 * Skips entirely if DATABASE_URL is unset. Each test cleans up the household it
 * creates (cascades to its assets and loans).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import { app } from './index.ts';

const hasDb = !!process.env.DATABASE_URL;

test('API write path', { skip: hasDb ? false : 'DATABASE_URL not set' }, async (t) => {
  const server = app.listen(0);
  await new Promise((r) => server.once('listening', r));
  const base = `http://localhost:${(server.address() as AddressInfo).port}`;

  const call = async (method: string, path: string, body?: unknown) => {
    const res = await fetch(`${base}${path}`, {
      method,
      headers: { 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await res.text();
    return { status: res.status, body: text ? JSON.parse(text) : undefined };
  };

  let householdId = '';

  try {
    await t.test('creates a household with cash-flow inputs', async () => {
      const { status, body } = await call('POST', '/api/households', {
        displayName: 'Test HH', monthlyTakeHome: 200000, monthlyEssential: 60000,
      });
      assert.equal(status, 201);
      assert.equal(body.displayName, 'Test HH');
      assert.equal(body.monthlyTakeHome, 200000); // rupees in, rupees out
      householdId = body.id;
    });

    await t.test('adds a real-estate asset and persists its profile', async () => {
      const { status, body } = await call('POST', `/api/households/${householdId}/assets`, {
        name: 'Flat', assetClass: 'real_estate', value: 12000000, liquid: false,
        realEstate: { address: '1 Road', sqft: 1450, ptin: 'PTIN-1', undividedShare: '3%' },
      });
      assert.equal(status, 201);
      assert.equal(body.value, 12000000);
      assert.equal(body.realEstate.ptin, 'PTIN-1');
      assert.equal(body.realEstate.sqft, 1450);
    });

    await t.test('money round-trips through paise without drift', async () => {
      const { body } = await call('POST', `/api/households/${householdId}/assets`, {
        name: 'Odd', assetClass: 'cash', value: 12345.67, liquid: true,
      });
      assert.equal(body.value, 12345.67);
    });

    await t.test('rejects an invalid asset class (400)', async () => {
      const { status, body } = await call('POST', `/api/households/${householdId}/assets`, {
        name: 'x', assetClass: 'crypto', value: 100,
      });
      assert.equal(status, 400);
      assert.equal(body.error, 'invalid_input');
    });

    await t.test('rejects a missing required field (400)', async () => {
      const { status } = await call('POST', `/api/households/${householdId}/assets`, {
        assetClass: 'cash', value: 100, // no name
      });
      assert.equal(status, 400);
    });

    await t.test('adds a loan secured against the flat and computes exposure', async () => {
      const assets = (await call('GET', `/api/households/${householdId}/assets`)).body;
      const flat = assets.find((a: any) => a.assetClass === 'real_estate');
      const { status } = await call('POST', `/api/households/${householdId}/loans`, {
        name: 'Home loan', outstanding: 9000000, emiMonthly: 78000, ratePct: 8.5, securedAssetId: flat.id,
      });
      assert.equal(status, 201);

      const a = (await call('GET', `/api/households/${householdId}/assessment`)).body;
      // gross 12,000,000 + 12,345.67 = 12,012,345.67 ; debt 9,000,000
      assert.equal(Math.round(a.netWorth.netWorth), 3012346);
      assert.equal(Math.round(a.exposure.realEstateLTV), 75); // 9M / 12M
      assert.equal(Math.round(a.exposure.emiToIncome), 39);    // 78k / 200k
    });

    await t.test('rejects a rate outside 0–100 (400)', async () => {
      const { status } = await call('POST', `/api/households/${householdId}/loans`, {
        name: 'Bad', outstanding: 1, emiMonthly: 1, ratePct: 150,
      });
      assert.equal(status, 400);
    });

    await t.test('updates a household field via PATCH', async () => {
      const { status, body } = await call('PATCH', `/api/households/${householdId}`, { monthlyTakeHome: 250000 });
      assert.equal(status, 200);
      assert.equal(body.monthlyTakeHome, 250000);
    });

    await t.test('404s for an unknown household', async () => {
      const { status } = await call('GET', '/api/households/00000000-0000-0000-0000-000000000000/assessment');
      assert.equal(status, 404);
    });

    await t.test('deletes an asset (204)', async () => {
      const assets = (await call('GET', `/api/households/${householdId}/assets`)).body;
      const { status } = await call('DELETE', `/api/assets/${assets[0].id}`);
      assert.equal(status, 204);
    });
  } finally {
    if (householdId) await call('DELETE', `/api/households/${householdId}`);
    await new Promise((r) => server.close(r));
  }
});
