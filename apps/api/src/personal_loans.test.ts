/**
 * Personal loans given/taken: interest math, the net summary, the interest
 * ledger, and folding principal into net worth (given → assets, taken → debt).
 * Skips without DATABASE_URL.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import { app } from './index.ts';
import { periodicInterest } from './personalLoans.ts';

const hasDb = !!process.env.DATABASE_URL;
const email = (p: string) => `${p}_${Date.now()}_${Math.random().toString(36).slice(2, 9)}@example.com`;

test('periodicInterest by frequency (pure)', () => {
  // ₹10,00,000 at 12% = ₹1,20,000/yr
  assert.equal(Math.round(periodicInterest(1000000, 12, 'monthly')), 10000);
  assert.equal(Math.round(periodicInterest(1000000, 12, 'quarterly')), 30000);
  assert.equal(Math.round(periodicInterest(1000000, 12, 'half_yearly')), 60000);
  assert.equal(Math.round(periodicInterest(1000000, 12, 'yearly')), 120000);
  assert.equal(periodicInterest(1000000, null, 'monthly'), 0);
});

test('personal loans: summary, net worth folding, ledger', { skip: hasDb ? false : 'DATABASE_URL not set' }, async (t) => {
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
    const reg = await call('POST', '/api/auth/register', { email: email('pl'), password: 'secret123', fullName: 'PL Owner' });
    tok = reg.body.token; hh = reg.body.user.householdId;
    // baseline net worth: one asset, no loans
    await call('POST', `/api/households/${hh}/assets`, { name: 'Cash', assetClass: 'cash', value: 500000 }, tok);
    const baseNw = (await call('GET', `/api/households/${hh}/assessment`, undefined, tok)).body.netWorth;
    assert.equal(baseNw.netWorth, 500000);

    let givenId = '';
    await t.test('lend money → asset + interest income summary', async () => {
      const g = await call('POST', `/api/households/${hh}/personal-loans`,
        { direction: 'given', counterparty: 'Cousin Ravi', principal: 1000000, ratePct: 12, frequency: 'quarterly', startedOn: '2025-04-01' }, tok);
      assert.equal(g.status, 201);
      givenId = g.body.id;
      assert.equal(g.body.interestPerPeriod, 30000);   // 12% of 10L ÷ 4
      assert.equal(g.body.monthlyInterest, 10000);
      const s = (await call('GET', `/api/households/${hh}/personal-loans`, undefined, tok)).body;
      assert.equal(s.givenPrincipal, 1000000);
      assert.equal(s.monthlyInterestIn, 10000);
      assert.equal(s.netPrincipal, 1000000);
    });

    await t.test('borrow money → liability; net is given − taken', async () => {
      await call('POST', `/api/households/${hh}/personal-loans`,
        { direction: 'taken', counterparty: 'Friend Sam', principal: 400000, ratePct: 9, frequency: 'monthly' }, tok);
      const s = (await call('GET', `/api/households/${hh}/personal-loans`, undefined, tok)).body;
      assert.equal(s.takenPrincipal, 400000);
      assert.equal(s.netPrincipal, 600000);            // 10L lent − 4L borrowed
      assert.equal(s.monthlyInterestOut, 3000);        // 9% of 4L ÷ 12
    });

    await t.test('net worth folds them in (given → assets, taken → debt)', async () => {
      const nw = (await call('GET', `/api/households/${hh}/assessment`, undefined, tok)).body.netWorth;
      assert.equal(nw.grossAssets, 1500000);           // 5L cash + 10L lent
      assert.equal(nw.totalDebt, 400000);              // 4L borrowed
      assert.equal(nw.netWorth, 1100000);              // 5L + (10L − 4L)
    });

    await t.test('interest ledger records actual receipts', async () => {
      await call('POST', `/api/personal-loans/${givenId}/payments`, { paidOn: new Date().toISOString().slice(0, 10), amount: 30000, kind: 'interest' }, tok);
      const pays = (await call('GET', `/api/personal-loans/${givenId}/payments`, undefined, tok)).body;
      assert.equal(pays.length, 1);
      assert.equal(pays[0].amount, 30000);
      const s = (await call('GET', `/api/households/${hh}/personal-loans`, undefined, tok)).body;
      assert.equal(s.interestReceivedLast12, 30000);
    });

    await t.test('deleting a personal loan removes it from net worth', async () => {
      await call('DELETE', `/api/personal-loans/${givenId}`, undefined, tok);
      const nw = (await call('GET', `/api/households/${hh}/assessment`, undefined, tok)).body.netWorth;
      assert.equal(nw.grossAssets, 500000);            // the 10L lent is gone
      assert.equal(nw.netWorth, 100000);               // 5L − 4L borrowed
    });
  } finally {
    if (hh) await call('DELETE', `/api/households/${hh}`, undefined, tok);
    await new Promise((r) => server.close(r));
  }
});
