/**
 * Family members: income aggregation to the household, per-member exposure,
 * and access (operations see names but not incomes). Skips without DATABASE_URL.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import { app } from './index.ts';

const hasDb = !!process.env.DATABASE_URL;
const email = (p: string) => `${p}_${Date.now()}_${Math.random().toString(36).slice(2, 9)}@example.com`;

test('family members', { skip: hasDb ? false : 'DATABASE_URL not set' }, async (t) => {
  const server = app.listen(0);
  await new Promise((r) => server.once('listening', r));
  const base = `http://localhost:${(server.address() as AddressInfo).port}`;

  const call = async (method: string, path: string, body?: unknown, token?: string) => {
    const res = await fetch(`${base}${path}`, {
      method,
      headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await res.text();
    return { status: res.status, body: text ? JSON.parse(text) : undefined };
  };

  let ownerTok = '', opsTok = '', householdId = '', memberA = '', assetId = '';

  try {
    // Register owner WITHOUT a household income, so aggregation from members is unambiguous.
    const reg = await call('POST', '/api/auth/register', { email: email('owner'), password: 'secret123', householdName: 'Fam' });
    ownerTok = reg.body.token;
    householdId = reg.body.user.householdId;

    await t.test('members aggregate to the household income', async () => {
      memberA = (await call('POST', `/api/households/${householdId}/members`, { name: 'A', monthlyIncome: 100000, monthlyEssential: 30000 }, ownerTok)).body.id;
      await call('POST', `/api/households/${householdId}/members`, { name: 'B', monthlyIncome: 60000 }, ownerTok);
      // A ₹50L asset + a ₹32k EMI loan → household income should be 160000 (100k+60k) → EMI 20%.
      assetId = (await call('POST', `/api/households/${householdId}/assets`, { name: 'Flat', assetClass: 'real_estate', value: 5000000, liquid: false }, ownerTok)).body.id;
      await call('POST', `/api/households/${householdId}/loans`, { name: 'Home', outstanding: 3000000, emiMonthly: 32000 }, ownerTok);
      const ex = (await call('GET', `/api/households/${householdId}/assessment`, undefined, ownerTok)).body.exposure;
      assert.equal(Math.round(ex.emiToIncome), 20); // 32000 / 160000
    });

    await t.test('per-member assessment uses that member’s own assets/income', async () => {
      // Attribute the flat + loan to member A.
      await call('PATCH', `/api/assets/${assetId}`, { memberId: memberA }, ownerTok);
      const loans = (await call('GET', `/api/households/${householdId}/loans`, undefined, ownerTok)).body;
      await call('PATCH', `/api/loans/${loans[0].id}`, { memberId: memberA }, ownerTok);

      const members = (await call('GET', `/api/households/${householdId}/members/assessment`, undefined, ownerTok)).body;
      const a = members.find((m: any) => m.id === memberA);
      const b = members.find((m: any) => m.name === 'B');
      assert.equal(a.assessment.netWorth.netWorth, 2000000); // 50L asset − 30L loan
      assert.equal(Math.round(a.assessment.exposure.emiToIncome), 32); // 32k / 100k (A's own income)
      assert.equal(b.assessment.netWorth.netWorth, 0); // B owns nothing
    });

    await t.test('operations see member names but not incomes', async () => {
      await call('POST', `/api/households/${householdId}/users`, { email: email('ops'), password: 'secret123', role: 'operations' }, ownerTok);
      // login the ops user we just made
      const opsEmail = (await call('GET', `/api/households/${householdId}/users`, undefined, ownerTok)).body.find((u: any) => u.role === 'operations').email;
      opsTok = (await call('POST', '/api/auth/login', { email: opsEmail, password: 'secret123' })).body.token;

      const list = (await call('GET', `/api/households/${householdId}/members`, undefined, opsTok)).body;
      assert.equal(list.length, 2);
      assert.equal(list[0].name != null, true);
      assert.equal(list[0].monthlyIncome, null); // income hidden
    });

    await t.test('operations cannot add members or see per-member exposure', async () => {
      assert.equal((await call('POST', `/api/households/${householdId}/members`, { name: 'X' }, opsTok)).status, 403);
      assert.equal((await call('GET', `/api/households/${householdId}/members/assessment`, undefined, opsTok)).status, 403);
    });
  } finally {
    if (householdId) await call('DELETE', `/api/households/${householdId}`, undefined, ownerTok);
    await new Promise((r) => server.close(r));
  }
});
