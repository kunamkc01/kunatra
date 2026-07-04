/**
 * Login/access telemetry: geo capture from CloudFront viewer headers, UA
 * parsing, success/failure recording, and access control on the reads.
 * Skips without DATABASE_URL.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import { app } from './index.ts';
import { parseUserAgent } from './access.ts';

const hasDb = !!process.env.DATABASE_URL;
const email = (p: string) => `${p}_${Date.now()}_${Math.random().toString(36).slice(2, 9)}@example.com`;

const CHROME_WIN = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';
const SAFARI_IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';

const GEO_HEADERS = {
  'cloudfront-viewer-address': '49.43.216.129:51423',
  'cloudfront-viewer-country': 'IN',
  'cloudfront-viewer-country-name': 'India',
  'cloudfront-viewer-country-region-name': 'Telangana',
  'cloudfront-viewer-city': 'Hyderabad',
  'cloudfront-viewer-time-zone': 'Asia/Kolkata',
  'cloudfront-viewer-asn': '55836',
  'cloudfront-viewer-latitude': '17.44210',
  'cloudfront-viewer-longitude': '78.39174',
  'user-agent': CHROME_WIN,
};

test('user-agent parsing (pure)', () => {
  assert.deepEqual(parseUserAgent(CHROME_WIN), { browser: 'Chrome', os: 'Windows', device: 'desktop' });
  assert.deepEqual(parseUserAgent(SAFARI_IPHONE), { browser: 'Safari', os: 'iOS', device: 'mobile' });
  assert.equal(parseUserAgent('').device, 'other');
});

test('login/access telemetry', { skip: hasDb ? false : 'DATABASE_URL not set' }, async (t) => {
  const server = app.listen(0);
  await new Promise((r) => server.once('listening', r));
  const base = `http://localhost:${(server.address() as AddressInfo).port}`;
  const call = async (method: string, path: string, body?: unknown, token?: string, extra: Record<string, string> = {}) => {
    const res = await fetch(`${base}${path}`, {
      method, headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}), ...extra },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await res.text();
    return { status: res.status, body: text ? JSON.parse(text) : undefined };
  };
  const settle = () => new Promise((r) => setTimeout(r, 250)); // recording is fire-and-forget

  let ownerTok = '', householdId = '', ownerEmail = email('geo');
  try {
    const reg = await call('POST', '/api/auth/register', { email: ownerEmail, password: 'secret123' }, undefined, GEO_HEADERS);
    ownerTok = reg.body.token; householdId = reg.body.user.householdId;

    await t.test('register + login events carry geography and device', async () => {
      await call('POST', '/api/auth/login', { email: ownerEmail, password: 'secret123' }, undefined, GEO_HEADERS);
      await settle();
      const s = (await call('GET', '/api/auth/signins', undefined, ownerTok)).body;
      assert.ok(s.length >= 2); // register + login
      const login = s.find((x: any) => x.event === 'login');
      assert.equal(login.success, true);
      assert.equal(login.country, 'IN');
      assert.equal(login.region, 'Telangana');
      assert.equal(login.city, 'Hyderabad');
      assert.equal(login.timeZone, 'Asia/Kolkata');
      assert.equal(login.asn, '55836');
      assert.equal(login.lat, 17.4);           // rounded to ~11km
      assert.equal(login.lon, 78.4);
      assert.equal(login.browser, 'Chrome');
      assert.equal(login.os, 'Windows');
      assert.equal(login.device, 'desktop');
      assert.equal(login.method, 'password');
    });

    await t.test('failed logins are recorded with success=false', async () => {
      const r = await call('POST', '/api/auth/login', { email: ownerEmail, password: 'WRONG' }, undefined, GEO_HEADERS);
      assert.equal(r.status, 401);
      await settle();
      const s = (await call('GET', '/api/auth/signins', undefined, ownerTok)).body;
      assert.ok(s.some((x: any) => x.event === 'login' && x.success === false));
    });

    await t.test('missing CloudFront headers degrade gracefully', async () => {
      await call('POST', '/api/auth/login', { email: ownerEmail, password: 'secret123' },
        undefined, { 'user-agent': SAFARI_IPHONE });
      await settle();
      const s = (await call('GET', '/api/auth/signins', undefined, ownerTok)).body;
      const latest = s[0];
      assert.equal(latest.country, null);      // no geo without the headers
      assert.equal(latest.device, 'mobile');   // UA still parsed
    });

    await t.test('admin signins are forbidden to normal users', async () => {
      assert.equal((await call('GET', '/api/admin/signins', undefined, ownerTok)).status, 403);
    });
  } finally {
    if (householdId) await call('DELETE', `/api/households/${householdId}`, undefined, ownerTok);
    await new Promise((r) => server.close(r));
  }
});
