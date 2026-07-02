/**
 * Calendar-driven (fixed) work-order recurrence and the rent roll. Skips without
 * DATABASE_URL.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import { app } from './index.ts';
import { sweepFixedWorkOrders } from './ops.ts';

const hasDb = !!process.env.DATABASE_URL;
const email = (p: string) => `${p}_${Date.now()}_${Math.random().toString(36).slice(2, 9)}@example.com`;
const daysAgo = (n: number) => new Date(Date.now() - n * 86400000).toISOString().slice(0, 10);

test('fixed recurrence & rent roll', { skip: hasDb ? false : 'DATABASE_URL not set' }, async (t) => {
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
    const reg = await call('POST', '/api/auth/register', { email: email('owner'), password: 'secret123' });
    ownerTok = reg.body.token; householdId = reg.body.user.householdId;

    await t.test('fixed monthly work order generates missed periods without completion', async () => {
      const start = daysAgo(75); // ~2.5 months ago → 2 due periods since
      const wo = await call('POST', `/api/households/${householdId}/work-orders`,
        { title: 'Collect rent (task)', category: 'other', recurrence: 'monthly', recurrenceMode: 'fixed', scheduledFor: start }, ownerTok);
      assert.equal(wo.status, 201);
      assert.equal(wo.body.recurrenceMode, 'fixed');

      await sweepFixedWorkOrders(); // the daily calendar sweep

      const all = (await call('GET', `/api/households/${householdId}/work-orders`, undefined, ownerTok)).body;
      const mine = all.filter((w: any) => w.title === 'Collect rent (task)');
      assert.ok(mine.length >= 2, `expected >= 2 occurrences, got ${mine.length}`); // generated despite none being completed
      assert.ok(mine.every((w: any) => w.status === 'open')); // nothing had to be closed first
    });

    await t.test('on_completion recurrence still waits for a close (unchanged)', async () => {
      const wo = await call('POST', `/api/households/${householdId}/work-orders`,
        { title: 'Chained AMC', category: 'amc', recurrence: 'quarterly', recurrenceMode: 'on_completion', scheduledFor: daysAgo(100) }, ownerTok);
      await sweepFixedWorkOrders(); // should NOT touch on_completion series
      let mine = (await call('GET', `/api/households/${householdId}/work-orders`, undefined, ownerTok)).body.filter((w: any) => w.title === 'Chained AMC');
      assert.equal(mine.length, 1);
      await call('PATCH', `/api/work-orders/${wo.body.id}`, { status: 'done', actualCost: 5000 }, ownerTok);
      mine = (await call('GET', `/api/households/${householdId}/work-orders`, undefined, ownerTok)).body.filter((w: any) => w.title === 'Chained AMC');
      assert.equal(mine.length, 2); // one more only after completion
    });

    let rentId = '';
    await t.test('renting a property opens a rent line for this month', async () => {
      await call('POST', `/api/households/${householdId}/assets`,
        { name: 'Rented flat', assetClass: 'real_estate', value: 9000000, monthlyRent: 30000, rentTds: 3000 }, ownerTok);
      const roll = (await call('GET', `/api/households/${householdId}/rent`, undefined, ownerTok)).body;
      assert.equal(roll.length, 1);
      assert.equal(roll[0].status, 'due');
      assert.equal(roll[0].amountDue, 30000);
      assert.equal(roll[0].netDue, 27000); // gross − TDS
      rentId = roll[0].id;
    });

    await t.test('collecting rent updates the line and the summary', async () => {
      const before = (await call('GET', `/api/households/${householdId}/rent/summary`, undefined, ownerTok)).body;
      assert.equal(before.outstandingCount, 1);
      const c = await call('POST', `/api/rent/${rentId}/collect`, {}, ownerTok);
      assert.equal(c.status, 200);
      assert.equal(c.body.status, 'collected');
      assert.equal(c.body.collected, 27000); // defaults to net due
      assert.ok(c.body.collectedOn);
      const after = (await call('GET', `/api/households/${householdId}/rent/summary`, undefined, ownerTok)).body;
      assert.equal(after.outstandingCount, 0);
    });
  } finally {
    if (householdId) await call('DELETE', `/api/households/${householdId}`, undefined, ownerTok);
    await new Promise((r) => server.close(r));
  }
});
