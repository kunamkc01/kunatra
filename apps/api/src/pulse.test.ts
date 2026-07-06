/**
 * Pulse aggregates: the register's per-property operational state and the
 * asset page's this-month card + activity feed. Skips without DATABASE_URL.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import { app } from './index.ts';
import { _setStorageForTests, type DocStorage } from './documents.ts';

const hasDb = !!process.env.DATABASE_URL;
const email = (p: string) => `${p}_${Date.now()}_${Math.random().toString(36).slice(2, 9)}@example.com`;

const memory = new Map<string, { body: Buffer; contentType: string }>();
const memStorage: DocStorage = {
  async put(key, body, contentType) { memory.set(key, { body, contentType }); },
  async get(key) { const v = memory.get(key); if (!v) throw new Error('missing'); return v.body; },
  async remove(key) { memory.delete(key); },
};
const PDF = 'data:application/pdf;base64,' + Buffer.from('%PDF-1.4 pulse bytes').toString('base64');

test('pulse: property aggregate + asset activity feed', { skip: hasDb ? false : 'DATABASE_URL not set' }, async (t) => {
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

  let tok = '', hh = '', rented = '', plot = '';
  try {
    _setStorageForTests(memStorage);
    const reg = await call('POST', '/api/auth/register', { email: email('pulse'), password: 'secret123', fullName: 'Pulse Owner' });
    tok = reg.body.token; hh = reg.body.user.householdId;

    rented = (await call('POST', `/api/households/${hh}/assets`, {
      name: 'Pulse flat', assetClass: 'real_estate', value: 9000000, monthlyRent: 30000, tenantName: 'T Tenant',
      realEstate: { city: 'Hyderabad', locality: 'Madhapur', sqft: 1200 },
    }, tok)).body.id;
    plot = (await call('POST', `/api/households/${hh}/assets`, { name: 'Pulse plot', assetClass: 'real_estate', value: 5000000 }, tok)).body.id;

    // collect this month's rent; upload a doc; tenant raises a request
    const roll = (await call('GET', `/api/households/${hh}/rent`, undefined, tok)).body;
    await call('POST', `/api/rent/${roll[0].id}/collect`, {}, tok);
    await call('POST', `/api/assets/${rented}/documents`, { name: 'agreement.pdf', kind: 'agreement', dataUrl: PDF }, tok);
    const link = (await call('POST', `/api/assets/${rented}/tenant`, { name: 'T Tenant' }, tok)).body.link;
    const tt = link.split('t=')[1];
    await fetch(`${base}/api/tenant/requests`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-tenant-token': tt }, body: JSON.stringify({ title: 'Leak' }) });

    await t.test('property-pulse aggregates per asset', async () => {
      const list = (await call('GET', `/api/households/${hh}/property-pulse`, undefined, tok)).body;
      assert.equal(list.length, 2);
      const p = list.find((x: any) => x.assetId === rented);
      assert.equal(p.rentStatus, 'collected');
      assert.equal(p.rentDots.length, 6);
      assert.equal(p.rentDots[5].status, 'collected');   // current month is last
      assert.equal(p.openRequests, 1);
      assert.equal(p.tenantRaised, true);
      assert.equal(p.docCount, 1);
      const q = list.find((x: any) => x.assetId === plot);
      assert.equal(q.rentStatus, null);
      assert.equal(q.openRequests, 0);
    });

    await t.test('asset pulse: this-month card + activity', async () => {
      const p = (await call('GET', `/api/assets/${rented}/pulse`, undefined, tok)).body;
      assert.equal(p.rent.status, 'collected');
      assert.equal(p.rent.amountDue, 30000);
      assert.equal(p.openWorkOrders.length, 1);
      assert.equal(p.openWorkOrders[0].tenantRaised, true);
      const kinds = p.activity.map((a: any) => a.kind);
      assert.ok(kinds.includes('rent'));
      assert.ok(kinds.includes('document'));
      assert.ok(kinds.includes('tenant_request'));
    });

    await t.test('compliance shows as next due', async () => {
      await call('POST', `/api/households/${hh}/compliance`, { title: 'Property tax', kind: 'property_tax', dueOn: '2099-11-01', assetId: rented }, tok);
      const p = (await call('GET', `/api/assets/${rented}/pulse`, undefined, tok)).body;
      assert.equal(p.nextCompliance.title, 'Property tax');
    });
  } finally {
    _setStorageForTests(null);
    if (hh) await call('DELETE', `/api/households/${hh}`, undefined, tok);
    await new Promise((r) => server.close(r));
  }
});
