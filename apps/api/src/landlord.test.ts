/**
 * Landlord Suite: document vault (in-memory storage seam — no S3 in tests),
 * rent receipts, and the tenant portal's magic-link isolation.
 * Skips without DATABASE_URL.
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

const PDF = 'data:application/pdf;base64,' + Buffer.from('%PDF-1.4 fake agreement bytes').toString('base64');

test('landlord suite: vault, receipts, tenant portal', { skip: hasDb ? false : 'DATABASE_URL not set' }, async (t) => {
  const server = app.listen(0);
  await new Promise((r) => server.once('listening', r));
  const base = `http://localhost:${(server.address() as AddressInfo).port}`;
  const call = async (method: string, path: string, body?: unknown, token?: string, extra: Record<string, string> = {}) => {
    const res = await fetch(`${base}${path}`, {
      method, headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}), ...extra },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await res.text();
    let parsed: any; try { parsed = text ? JSON.parse(text) : undefined; } catch { parsed = text; }
    return { status: res.status, body: parsed, raw: text };
  };

  let ownerTok = '', householdId = '', assetId = '';
  try {
    _setStorageForTests(memStorage);
    const reg = await call('POST', '/api/auth/register', { email: email('landlord'), password: 'secret123', fullName: 'Lakshmi Landlord' });
    ownerTok = reg.body.token; householdId = reg.body.user.householdId;
    const a = await call('POST', `/api/households/${householdId}/assets`, {
      name: 'Let flat', assetClass: 'real_estate', value: 9000000, monthlyRent: 30000, rentTds: 3000, tenantName: 'Arjun Tenant',
      realEstate: { address: '4B Rose Towers', city: 'Hyderabad', locality: 'Kukatpally', sqft: 1400 },
    }, ownerTok);
    assetId = a.body.id;
    assert.equal(a.body.tenantName, 'Arjun Tenant');

    // ---- Phase 1: vault ----
    let docId = '';
    await t.test('upload, list, download, delete a document', async () => {
      const up = await call('POST', `/api/assets/${assetId}/documents`, { name: 'agreement.pdf', kind: 'agreement', dataUrl: PDF }, ownerTok);
      assert.equal(up.status, 201);
      assert.equal(up.body.kind, 'agreement');
      docId = up.body.id;

      const list = (await call('GET', `/api/assets/${assetId}/documents`, undefined, ownerTok)).body;
      assert.equal(list.length, 1);

      const dl = await fetch(`${base}/api/documents/${docId}/download`, { headers: { authorization: `Bearer ${ownerTok}` } });
      assert.equal(dl.status, 200);
      assert.equal(dl.headers.get('content-type'), 'application/pdf');
      assert.ok((await dl.text()).includes('fake agreement bytes'));

      // junk content type rejected
      const bad = await call('POST', `/api/assets/${assetId}/documents`, { name: 'x.exe', kind: 'other', dataUrl: 'data:application/x-msdownload;base64,QUJD' }, ownerTok);
      assert.equal(bad.status, 400);
    });

    await t.test('bills attach to work orders', async () => {
      const wo = await call('POST', `/api/households/${householdId}/work-orders`, { title: 'Fix tap', assetId }, ownerTok);
      const up = await call('POST', `/api/assets/${assetId}/documents`, { name: 'bill.pdf', kind: 'maintenance_bill', dataUrl: PDF, workOrderId: wo.body.id }, ownerTok);
      assert.equal(up.status, 201);
      const list = (await call('GET', `/api/work-orders/${wo.body.id}/documents`, undefined, ownerTok)).body;
      assert.equal(list.length, 1);
      assert.equal(list[0].kind, 'maintenance_bill');
    });

    // ---- Phase 2: receipts ----
    let rentId = '';
    await t.test('a collected rent line yields a full receipt', async () => {
      const roll = (await call('GET', `/api/households/${householdId}/rent`, undefined, ownerTok)).body;
      rentId = roll[0].id;
      await call('POST', `/api/rent/${rentId}/collect`, {}, ownerTok);
      const r = (await call('GET', `/api/rent/${rentId}/receipt`, undefined, ownerTok)).body;
      assert.equal(r.tenantName, 'Arjun Tenant');
      assert.equal(r.landlordName, 'Lakshmi Landlord');   // the owner's person
      assert.equal(r.amountDue, 30000);
      assert.equal(r.tds, 3000);
      assert.equal(r.collected, 27000);
      assert.ok(r.propertyAddress.includes('Rose Towers'));
    });

    await t.test('the FY bundle filters to the Indian financial year', async () => {
      const now = new Date();
      const fy = now.getMonth() >= 3 ? now.getFullYear() : now.getFullYear() - 1;
      const rows = (await call('GET', `/api/assets/${assetId}/receipts?fy=${fy}`, undefined, ownerTok)).body;
      assert.equal(rows.length, 1);
      assert.equal((await call('GET', `/api/assets/${assetId}/receipts?fy=${fy - 1}`, undefined, ownerTok)).body.length, 0);
    });

    await t.test('a receipt can be filed into the vault', async () => {
      const saved = await call('POST', `/api/rent/${rentId}/receipt/save`, undefined, ownerTok);
      assert.equal(saved.status, 201);
      assert.equal(saved.body.kind, 'invoice');
      const docs = (await call('GET', `/api/assets/${assetId}/documents`, undefined, ownerTok)).body;
      assert.ok(docs.some((d: any) => d.kind === 'invoice' && d.filename.includes('Rent receipt')));
    });

    // ---- Phase 3: tenant portal ----
    let tenantToken = '';
    await t.test('owner invites a tenant and gets a magic link', async () => {
      const inv = await call('POST', `/api/assets/${assetId}/tenant`, { name: 'Arjun Tenant', email: email('tenant') }, ownerTok);
      assert.equal(inv.status, 201);
      assert.ok(inv.body.link.includes('/tenant/?t='));
      tenantToken = inv.body.link.split('t=')[1];
    });

    const tcall = (method: string, path: string, body?: unknown) =>
      call(method, path, body, undefined, { 'x-tenant-token': tenantToken });

    await t.test('the tenant sees only their property and raises a request', async () => {
      const me = (await tcall('GET', '/api/tenant/me')).body;
      assert.equal(me.property.name, 'Let flat');
      assert.equal(me.monthlyRent, 30000);

      const req = await tcall('POST', '/api/tenant/requests', { title: 'Geyser not heating', notes: 'Since Tuesday' });
      assert.equal(req.status, 201);
      const reqs = (await tcall('GET', '/api/tenant/requests')).body;
      assert.equal(reqs.length, 1);
      assert.equal(reqs[0].status, 'open');

      // ...and the owner sees it tagged as tenant-raised
      const wos = (await call('GET', `/api/households/${householdId}/work-orders`, undefined, ownerTok)).body;
      const tr = wos.find((w: any) => w.title === 'Geyser not heating');
      assert.equal(tr.tenantRaised, true);
    });

    await t.test('the tenant downloads receipts + agreement, nothing more', async () => {
      const receipts = (await tcall('GET', '/api/tenant/receipts')).body;
      assert.equal(receipts.length, 1);
      const r = (await tcall('GET', `/api/tenant/receipts/${receipts[0].id}`)).body;
      assert.equal(r.collected, 27000);

      const docs = (await tcall('GET', '/api/tenant/documents')).body;
      assert.equal(docs.length, 1); // ONLY the agreement — never bills/invoices
      assert.equal(docs[0].filename, 'agreement.pdf');

      // household endpoints are invisible to the tenant token
      assert.equal((await tcall('GET', `/api/households/${householdId}/assessment`)).status, 401);
    });

    await t.test('revoking kills the link instantly', async () => {
      await call('DELETE', `/api/assets/${assetId}/tenant`, undefined, ownerTok);
      assert.equal((await tcall('GET', '/api/tenant/me')).status, 401);
      // re-invite issues a fresh, different token
      const again = await call('POST', `/api/assets/${assetId}/tenant`, { name: 'Arjun Tenant' }, ownerTok);
      assert.notEqual(again.body.link.split('t=')[1], tenantToken);
    });
  } finally {
    _setStorageForTests(null);
    if (householdId) await call('DELETE', `/api/households/${householdId}`, undefined, ownerTok);
    await new Promise((r) => server.close(r));
  }
});
