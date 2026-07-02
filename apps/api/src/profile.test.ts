/**
 * Profile/avatar, password (change / owner-reset / forgot-reset) and recurring
 * work orders + inspections. Skips without DATABASE_URL.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import { app } from './index.ts';
import { signToken } from './auth.ts';

const hasDb = !!process.env.DATABASE_URL;
const email = (p: string) => `${p}_${Date.now()}_${Math.random().toString(36).slice(2, 9)}@example.com`;
const PX = 'data:image/png;base64,iVBORw0KGgo=';

test('profile, passwords & recurring ops', { skip: hasDb ? false : 'DATABASE_URL not set' }, async (t) => {
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

  let ownerTok = '', householdId = '', ownerEmail = email('owner');

  try {
    const reg = await call('POST', '/api/auth/register', { email: ownerEmail, password: 'secret123', fullName: 'Owner' });
    ownerTok = reg.body.token;
    householdId = reg.body.user.householdId;

    await t.test('update profile name + avatar', async () => {
      const r = await call('PATCH', '/api/auth/profile', { fullName: 'Priya Sharma', avatar: PX }, ownerTok);
      assert.equal(r.status, 200);
      assert.equal(r.body.fullName, 'Priya Sharma');
      assert.equal(r.body.avatar, PX);
      const bad = await call('PATCH', '/api/auth/profile', { avatar: 'not-an-image' }, ownerTok);
      assert.equal(bad.status, 400);
    });

    await t.test('change password (needs the current one)', async () => {
      assert.equal((await call('POST', '/api/auth/password', { currentPassword: 'wrong', newPassword: 'newpass123' }, ownerTok)).status, 400);
      assert.equal((await call('POST', '/api/auth/password', { currentPassword: 'secret123', newPassword: 'newpass123' }, ownerTok)).status, 200);
      assert.equal((await call('POST', '/api/auth/login', { email: ownerEmail, password: 'secret123' })).status, 401);
      assert.equal((await call('POST', '/api/auth/login', { email: ownerEmail, password: 'newpass123' })).status, 200);
    });

    await t.test('owner resets a teammate password', async () => {
      const opsEmail = email('ops');
      const u = await call('POST', `/api/households/${householdId}/users`, { email: opsEmail, password: 'secret123', role: 'operations' }, ownerTok);
      assert.equal((await call('POST', `/api/users/${u.body.userId}/reset-password`, { newPassword: 'reset9999' }, ownerTok)).status, 200);
      assert.equal((await call('POST', '/api/auth/login', { email: opsEmail, password: 'reset9999' })).status, 200);
    });

    await t.test('forgot-password: always ok; a valid reset token sets the password', async () => {
      assert.equal((await call('POST', '/api/auth/forgot', { email: 'nobody@example.com' })).status, 200); // never reveals
      // simulate the emailed token
      const uid = reg.body.user.id;
      const token = signToken({ sub: uid, purpose: 'reset' }, 3600);
      assert.equal((await call('POST', '/api/auth/reset', { token, newPassword: 'viareset1' })).status, 200);
      assert.equal((await call('POST', '/api/auth/login', { email: ownerEmail, password: 'viareset1' })).status, 200);
      ownerTok = (await call('POST', '/api/auth/login', { email: ownerEmail, password: 'viareset1' })).body.token;
      // a reset token can't be used as a session
      assert.equal((await call('GET', '/api/auth/me', undefined, token)).status, 401);
    });

    await t.test('recurring work order regenerates the next on completion', async () => {
      const wo = await call('POST', `/api/households/${householdId}/work-orders`,
        { title: 'Lift AMC', category: 'amc', recurrence: 'quarterly', scheduledFor: '2026-01-01', estimatedCost: 18000 }, ownerTok);
      assert.equal(wo.body.recurrence, 'quarterly');
      await call('PATCH', `/api/work-orders/${wo.body.id}`, { status: 'done', actualCost: 18000 }, ownerTok);
      const all = (await call('GET', `/api/households/${householdId}/work-orders`, undefined, ownerTok)).body;
      const lifts = all.filter((w: any) => w.title === 'Lift AMC');
      assert.equal(lifts.length, 2); // original (done) + a fresh open one
      const next = lifts.find((w: any) => w.status === 'open');
      assert.ok(next && next.scheduledFor === '2026-04-01'); // +3 months
    });

    await t.test('recurring inspection schedules the next on the compliance calendar', async () => {
      const before = (await call('GET', `/api/households/${householdId}/compliance`, undefined, ownerTok)).body.length;
      await call('POST', `/api/households/${householdId}/inspections`, { inspectedOn: '2026-06-01', rating: 'good', recurrence: 'yearly' }, ownerTok);
      const items = (await call('GET', `/api/households/${householdId}/compliance`, undefined, ownerTok)).body;
      assert.equal(items.length, before + 1);
      const insp = items.find((c: any) => c.kind === 'inspection' && c.dueOn === '2027-06-01');
      assert.ok(insp);
    });
  } finally {
    if (householdId) await call('DELETE', `/api/households/${householdId}`, undefined, ownerTok);
    await new Promise((r) => server.close(r));
  }
});
