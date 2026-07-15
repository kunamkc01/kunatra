/**
 * AI property valuation: auto-queue on create, provider abstraction (faked here —
 * no Bedrock in tests), strict validation → unavailable, feedback, refresh rate
 * limit, and the never-touch-the-user's-value rule. Skips without DATABASE_URL.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import { app } from './index.ts';
import { _setProviderForTests, parseEstimate } from './valuation.ts';

const hasDb = !!process.env.DATABASE_URL;
const email = (p: string) => `${p}_${Date.now()}_${Math.random().toString(36).slice(2, 9)}@example.com`;

const GOOD = JSON.stringify({
  estimatedValue: 9500000, lowValue: 8500000, highValue: 10500000,
  pricePerSqft: 6500, estimatedMonthlyRent: 28000, rentalYieldPct: 3.5,
  annualGrowthPct: 6, confidence: 'medium', summary: 'Established locality, mid-rise apartment.',
  reasons: ['Locality price band', 'Age of building'],
});

test('parseEstimate sanity rules (pure)', () => {
  assert.ok(parseEstimate(GOOD, 1450));
  assert.equal(parseEstimate('not json at all', null), null);
  assert.equal(parseEstimate(JSON.stringify({ estimatedValue: -5, lowValue: 1, highValue: 2 }), null), null);
  // low > estimate is inconsistent
  assert.equal(parseEstimate(JSON.stringify({ estimatedValue: 100, lowValue: 200, highValue: 300 }), null), null);
  // absurd ₹/sqft rejected
  assert.equal(parseEstimate(JSON.stringify({ estimatedValue: 9500000, lowValue: 9000000, highValue: 9900000, pricePerSqft: 900000 }), null), null);
  // markdown fences tolerated
  assert.ok(parseEstimate('```json\n' + GOOD + '\n```', 1450));
  // a value the KNOWN rent contradicts (implied yield >12.5%) is rejected:
  // ₹4.2L/mo rent on a ₹1.9Cr "estimate" = ~26% yield — not a believable price
  const lowball = JSON.stringify({ estimatedValue: 19000000, lowValue: 18000000, highValue: 20000000 });
  assert.equal(parseEstimate(lowball, 10500, 420000), null);
  assert.ok(parseEstimate(lowball, 10500, 30000)); // same numbers, modest rent → fine
});

test('property valuation flow', { skip: hasDb ? false : 'DATABASE_URL not set' }, async (t) => {
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
  const waitForStatus = async (assetId: string, want: string, tok: string) => {
    for (let i = 0; i < 40; i++) {
      const v = (await call('GET', `/api/assets/${assetId}/valuation`, undefined, tok)).body;
      if (v && v.status === want) return v;
      await new Promise((r) => setTimeout(r, 100));
    }
    throw new Error(`valuation never reached ${want}`);
  };

  let ownerTok = '', householdId = '';
  try {
    _setProviderForTests(async () => GOOD);
    const reg = await call('POST', '/api/auth/register', { email: email('owner'), password: 'secret123' });
    ownerTok = reg.body.token; householdId = reg.body.user.householdId;

    let assetId = '';
    await t.test('creating a property queues an estimate automatically', async () => {
      const a = await call('POST', `/api/households/${householdId}/assets`, {
        name: 'Insight flat', assetClass: 'real_estate', value: 9000000,
        realEstate: { address: '12 Test St', sqft: 1450, city: 'Hyderabad', locality: 'Kukatpally', propertyType: 'apartment', bedrooms: 3, builtYear: 2015 },
      }, ownerTok);
      assert.equal(a.status, 201);
      assetId = a.body.id;
      // profile round-trip carries the new fields
      assert.equal(a.body.realEstate.city, 'Hyderabad');
      assert.equal(a.body.realEstate.propertyType, 'apartment');
      const v = await waitForStatus(assetId, 'ok', ownerTok);
      assert.equal(v.estimatedValue, 9500000);
      assert.equal(v.lowValue, 8500000);
      assert.equal(v.confidence, 'medium');
      assert.ok(Array.isArray(v.reasons) && v.reasons.length === 2);
    });

    await t.test("the estimate never touches the user's asset value", async () => {
      const a = (await call('GET', `/api/assets/${assetId}`, undefined, ownerTok)).body;
      assert.equal(a.value, 9000000); // still what the user entered
    });

    await t.test('refresh is rate-limited (~once a day)', async () => {
      const r = await call('POST', `/api/assets/${assetId}/valuation/refresh`, undefined, ownerTok);
      assert.equal(r.status, 429);
    });

    await t.test('changing the address forces a fresh estimate (bypasses the rate limit)', async () => {
      // A new estimate exists (just generated) — a plain refresh would 429. But the
      // location is the estimate's core input, so editing it must re-estimate now.
      _setProviderForTests(async () => JSON.stringify({ ...JSON.parse(GOOD), estimatedValue: 12000000, lowValue: 11000000, highValue: 13000000 }));
      const p = await call('PATCH', `/api/assets/${assetId}`, { realEstate: { address: '99 New Road', sqft: 1450, city: 'Hyderabad', locality: 'Gachibowli' } }, ownerTok);
      assert.equal(p.status, 200);
      // poll until the estimate reflects the new locality's value
      let got = null;
      for (let i = 0; i < 40; i++) {
        const v = (await call('GET', `/api/assets/${assetId}/valuation`, undefined, ownerTok)).body;
        if (v?.status === 'ok' && v.estimatedValue === 12000000) { got = v; break; }
        await new Promise((r) => setTimeout(r, 100));
      }
      assert.ok(got, 'estimate should have refreshed after the address changed');
      _setProviderForTests(async () => GOOD);
    });

    await t.test('editing a non-location field does NOT force a re-estimate', async () => {
      // name change only → no new estimate; the rate limit still applies to refresh
      await call('PATCH', `/api/assets/${assetId}`, { name: 'Renamed flat' }, ownerTok);
      assert.equal((await call('POST', `/api/assets/${assetId}/valuation/refresh`, undefined, ownerTok)).status, 429);
    });

    await t.test('feedback is recorded', async () => {
      const f = await call('POST', `/api/assets/${assetId}/valuation/feedback`, { feedback: 'too_high', userValue: 8800000 }, ownerTok);
      assert.equal(f.status, 200);
      assert.equal(f.body.feedback, 'too_high');
      assert.equal(f.body.userValue, 8800000);
      assert.equal((await call('POST', `/api/assets/${assetId}/valuation/feedback`, { feedback: 'meh' }, ownerTok)).status, 400);
    });

    await t.test('no city/locality/address → not estimated (never guesses a location)', async () => {
      // A named property with no location must NOT be sent to the model — it would
      // default to a metro (Hyderabad). Mark unavailable with a location prompt.
      const b = await call('POST', `/api/households/${householdId}/assets`, { name: 'Seaside Cottage', assetClass: 'real_estate', value: 8000000 }, ownerTok);
      const v = await waitForStatus(b.body.id, 'unavailable', ownerTok);
      assert.equal(v.estimatedValue, null);
      assert.ok(/city or locality/i.test(v.summary ?? ''), 'unavailable reason should ask for a location');
      // adding a city unlocks the estimate (location change forces it)
      await call('PATCH', `/api/assets/${b.body.id}`, { realEstate: { city: 'Pune', locality: 'Kharadi', sqft: 1100 } }, ownerTok);
      const v2 = await waitForStatus(b.body.id, 'ok', ownerTok);
      assert.equal(v2.estimatedValue, 9500000);
    });

    await t.test('garbage from the model (twice) → unavailable, not stored junk', async () => {
      _setProviderForTests(async () => 'the market is vibrant and prices are up!');
      const b = await call('POST', `/api/households/${householdId}/assets`, {
        name: 'Junk flat', assetClass: 'real_estate', value: 100,
      }, ownerTok);
      const v = await waitForStatus(b.body.id, 'unavailable', ownerTok);
      assert.equal(v.estimatedValue, null);
    });

    await t.test('non-property assets have no valuation', async () => {
      const c = await call('POST', `/api/households/${householdId}/assets`, { name: 'FD', assetClass: 'fd', value: 100000 }, ownerTok);
      assert.equal((await call('GET', `/api/assets/${c.body.id}/valuation`, undefined, ownerTok)).body, null);
      assert.equal((await call('POST', `/api/assets/${c.body.id}/valuation/refresh`, undefined, ownerTok)).status, 400);
    });
  } finally {
    _setProviderForTests(null);
    if (householdId) await call('DELETE', `/api/households/${householdId}`, undefined, ownerTok);
    await new Promise((r) => server.close(r));
  }
});
