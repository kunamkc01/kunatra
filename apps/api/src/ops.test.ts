/**
 * Asset-operations integration tests: vendors, work-order lifecycle (state machine
 * + cost-at-closure gate), inspections, summary. Skips if DATABASE_URL is unset.
 * Run: node --env-file=.env --experimental-strip-types --test src/ops.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import { app } from './index.ts';

const hasDb = !!process.env.DATABASE_URL;

test('asset operations', { skip: hasDb ? false : 'DATABASE_URL not set' }, async (t) => {
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
  let assetId = '';

  try {
    const reg = (await call('POST', '/api/auth/register', {
      email: `ops_${Date.now()}_${Math.random().toString(36).slice(2, 9)}@example.com`, password: 'secret123', householdName: 'Ops HH',
    })).body;
    token = reg.token;
    householdId = reg.user.householdId;
    assetId = (await call('POST', `/api/households/${householdId}/assets`, {
      name: 'Home', assetClass: 'real_estate', value: 8000000, liquid: false,
    })).body.id;

    let vendorId = '';
    await t.test('creates a vendor', async () => {
      const { status, body } = await call('POST', `/api/households/${householdId}/vendors`, {
        name: 'Acme Plumbing', category: 'plumber', phone: '99999',
      });
      assert.equal(status, 201);
      assert.equal(body.name, 'Acme Plumbing');
      vendorId = body.id;
    });

    let woId = '';
    await t.test('creates a work order (defaults to open)', async () => {
      const { status, body } = await call('POST', `/api/households/${householdId}/work-orders`, {
        title: 'Fix leak', category: 'repair', assetId, vendorId, estimatedCost: 3000,
      });
      assert.equal(status, 201);
      assert.equal(body.status, 'open');
      assert.equal(body.assetName, 'Home');
      assert.equal(body.vendorName, 'Acme Plumbing');
      assert.equal(body.estimatedCost, 3000);
      woId = body.id;
    });

    await t.test('transitions open -> in_progress', async () => {
      const { status, body } = await call('PATCH', `/api/work-orders/${woId}`, { status: 'in_progress' });
      assert.equal(status, 200);
      assert.equal(body.status, 'in_progress');
    });

    await t.test('closure gate: cannot close without an actual cost (400)', async () => {
      const { status, body } = await call('PATCH', `/api/work-orders/${woId}`, { status: 'done' });
      assert.equal(status, 400);
      assert.equal(body.error, 'closure_requires_cost');
    });

    await t.test('closes with an actual cost', async () => {
      const { status, body } = await call('PATCH', `/api/work-orders/${woId}`, {
        status: 'done', actualCost: 3500, closureNote: 'Replaced washer',
      });
      assert.equal(status, 200);
      assert.equal(body.status, 'done');
      assert.equal(body.actualCost, 3500);
    });

    await t.test('rejects an illegal transition done -> cancelled (409)', async () => {
      const { status, body } = await call('PATCH', `/api/work-orders/${woId}`, { status: 'cancelled' });
      assert.equal(status, 409);
      assert.equal(body.error, 'invalid_transition');
    });

    await t.test('records an inspection', async () => {
      const { status, body } = await call('POST', `/api/households/${householdId}/inspections`, {
        assetId, inspectedOn: '2026-06-01', rating: 'fair', notes: 'Seepage on north wall',
      });
      assert.equal(status, 201);
      assert.equal(body.rating, 'fair');
      assert.equal(body.assetName, 'Home');
    });

    await t.test('rejects an invalid rating (400)', async () => {
      const { status } = await call('POST', `/api/households/${householdId}/inspections`, {
        assetId, inspectedOn: '2026-06-01', rating: 'terrible',
      });
      assert.equal(status, 400);
    });

    await t.test('summary reflects the closed work order and last inspection', async () => {
      const { status, body } = await call('GET', `/api/households/${householdId}/operations/summary`);
      assert.equal(status, 200);
      assert.equal(body.workOrders.done, 1);
      assert.equal(body.workOrders.active, 0);
      assert.equal(body.maintenanceSpendYtd, 3500);
      assert.equal(body.vendors, 1);
      assert.equal(body.lastInspection.rating, 'fair');
    });

    await t.test('deleting the asset keeps the work order (unlinked)', async () => {
      await call('DELETE', `/api/assets/${assetId}`);
      const { body } = await call('GET', `/api/work-orders/${woId}`);
      assert.equal(body.assetId, null);
      assert.equal(body.actualCost, 3500); // history preserved
    });
  } finally {
    if (householdId) await call('DELETE', `/api/households/${householdId}`);
    await new Promise((r) => server.close(r));
  }
});
