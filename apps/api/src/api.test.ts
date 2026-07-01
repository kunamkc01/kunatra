/**
 * API integration tests (authenticated). Exercise the write path against Postgres.
 * Run: node --env-file=.env --experimental-strip-types --test src/api.test.ts
 * Skips if DATABASE_URL is unset. Cleans up the household it creates.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import { app } from './index.ts';

const hasDb = !!process.env.DATABASE_URL;
const rand = () => Math.random().toString(36).slice(2, 9);
const uniqueEmail = () => `owner_${Date.now()}_${rand()}@example.com`;

test('API write path', { skip: hasDb ? false : 'DATABASE_URL not set' }, async (t) => {
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

  let householdId = '';

  try {
    await t.test('registers an owner (creates the household)', async () => {
      const { status, body } = await call('POST', '/api/auth/register', {
        email: uniqueEmail(), password: 'secret123', fullName: 'Test Owner',
        householdName: 'Test HH', monthlyTakeHome: 200000, monthlyEssential: 60000,
      });
      assert.equal(status, 201);
      assert.ok(body.token);
      assert.equal(body.user.role, 'owner');
      token = body.token;
      householdId = body.user.householdId;
    });

    await t.test('owner sees household with cash-flow inputs', async () => {
      const { status, body } = await call('GET', `/api/households/${householdId}`);
      assert.equal(status, 200);
      assert.equal(body.displayName, 'Test HH');
      assert.equal(body.monthlyTakeHome, 200000);
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

    await t.test('adds a loan secured against the flat and computes exposure', async () => {
      const assets = (await call('GET', `/api/households/${householdId}/assets`)).body;
      const flat = assets.find((a: any) => a.assetClass === 'real_estate');
      const { status } = await call('POST', `/api/households/${householdId}/loans`, {
        name: 'Home loan', outstanding: 9000000, emiMonthly: 78000, ratePct: 8.5, securedAssetId: flat.id,
      });
      assert.equal(status, 201);

      const a = (await call('GET', `/api/households/${householdId}/assessment`)).body;
      assert.equal(Math.round(a.netWorth.netWorth), 3012346);
      assert.equal(Math.round(a.exposure.realEstateLTV), 75);
      assert.equal(Math.round(a.exposure.emiToIncome), 39);
    });

    await t.test('unauthenticated requests are rejected (401)', async () => {
      const res = await fetch(`${base}/api/households/${householdId}/assessment`);
      assert.equal(res.status, 401);
    });

    await t.test('404s for an unknown household — 403 (not the caller\'s)', async () => {
      const { status } = await call('GET', '/api/households/00000000-0000-0000-0000-000000000000/assessment');
      assert.equal(status, 403);
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
