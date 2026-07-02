/**
 * Asset photos: add/list/delete, size + type validation, and member-own
 * scoping (a member manages only their own asset's pictures). Skips without
 * DATABASE_URL.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import { app } from './index.ts';

const hasDb = !!process.env.DATABASE_URL;
const email = (p: string) => `${p}_${Date.now()}_${Math.random().toString(36).slice(2, 9)}@example.com`;
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCA';

test('asset photos & scoping', { skip: hasDb ? false : 'DATABASE_URL not set' }, async (t) => {
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
    ownerTok = reg.body.token;
    householdId = reg.body.user.householdId;

    const wife = (await call('POST', `/api/households/${householdId}/members`, { name: 'Wife' }, ownerTok)).body;
    const wifeEmail = email('wife');
    await call('POST', `/api/households/${householdId}/users`, { email: wifeEmail, password: 'secret123', role: 'member', memberId: wife.id }, ownerTok);
    const wifeTok = (await call('POST', '/api/auth/login', { email: wifeEmail, password: 'secret123' })).body.token;

    // owner's asset, and the wife's own asset
    const ownerAsset = (await call('POST', `/api/households/${householdId}/assets`, { name: 'Home', assetClass: 'real_estate', value: 5000000 }, ownerTok)).body;
    const wifeAsset = (await call('POST', `/api/households/${householdId}/assets`, { name: 'Wife SIP', assetClass: 'sip', value: 100000 }, wifeTok)).body;

    let photoId = '';
    await t.test('owner adds and lists a photo', async () => {
      const r = await call('POST', `/api/assets/${ownerAsset.id}/photos`, { dataUrl: PNG, caption: 'front' }, ownerTok);
      assert.equal(r.status, 201);
      assert.equal(r.body.caption, 'front');
      photoId = r.body.id;
      const list = (await call('GET', `/api/assets/${ownerAsset.id}/photos`, undefined, ownerTok)).body;
      assert.equal(list.length, 1);
    });

    await t.test('non-image / oversized data is rejected', async () => {
      assert.equal((await call('POST', `/api/assets/${ownerAsset.id}/photos`, { dataUrl: 'not-an-image' }, ownerTok)).status, 400);
      assert.equal((await call('POST', `/api/assets/${ownerAsset.id}/photos`, { dataUrl: 'data:image/png;base64,' + 'A'.repeat(2_600_000) }, ownerTok)).status, 400);
    });

    await t.test('a member manages only their own asset\'s photos', async () => {
      // can add to her own asset
      const own = await call('POST', `/api/assets/${wifeAsset.id}/photos`, { dataUrl: PNG }, wifeTok);
      assert.equal(own.status, 201);
      // cannot add to the owner's asset
      assert.equal((await call('POST', `/api/assets/${ownerAsset.id}/photos`, { dataUrl: PNG }, wifeTok)).status, 403);
      // cannot delete the owner's photo
      assert.equal((await call('DELETE', `/api/photos/${photoId}`, undefined, wifeTok)).status, 403);
      // but can delete her own
      const mine = (await call('GET', `/api/assets/${wifeAsset.id}/photos`, undefined, wifeTok)).body[0];
      assert.equal((await call('DELETE', `/api/photos/${mine.id}`, undefined, wifeTok)).status, 204);
    });

    await t.test('owner can delete any photo in the household', async () => {
      assert.equal((await call('DELETE', `/api/photos/${photoId}`, undefined, ownerTok)).status, 204);
      assert.equal((await call('GET', `/api/assets/${ownerAsset.id}/photos`, undefined, ownerTok)).body.length, 0);
    });
  } finally {
    if (householdId) await call('DELETE', `/api/households/${householdId}`, undefined, ownerTok);
    await new Promise((r) => server.close(r));
  }
});
