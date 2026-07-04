// Login/access telemetry. Geography comes from CloudFront's viewer headers
// (forwarded by the /api/* cache policy) — no external geo-IP service. The
// device fingerprint is a light UA parse. Recording is always best-effort:
// telemetry must never break auth.
import type { Request } from 'express';
import { db } from './pool.ts';
import { sendEmail } from './notify.ts';

export interface ClientContext {
  ip: string | null;
  country: string | null; countryName: string | null; region: string | null; city: string | null;
  timeZone: string | null; asn: string | null;
  lat: number | null; lon: number | null;      // rounded to ~11km for privacy
  browser: string | null; os: string | null; device: string;
  userAgent: string | null;
}

/** A deliberately small UA parse — analytics-grade, not fingerprinting. */
export function parseUserAgent(ua: string): { browser: string | null; os: string | null; device: string } {
  const browser =
    /Edg\//.test(ua) ? 'Edge'
    : /OPR\/|Opera/.test(ua) ? 'Opera'
    : /SamsungBrowser/.test(ua) ? 'Samsung Internet'
    : /Chrome\//.test(ua) ? 'Chrome'
    : /Firefox\//.test(ua) ? 'Firefox'
    : /Safari\//.test(ua) ? 'Safari'
    : ua ? 'Other' : null;
  const os =
    /iPhone|iPad|iPod/.test(ua) ? 'iOS'
    : /Android/.test(ua) ? 'Android'
    : /Windows/.test(ua) ? 'Windows'
    : /Mac OS X|Macintosh/.test(ua) ? 'macOS'
    : /Linux/.test(ua) ? 'Linux'
    : ua ? 'Other' : null;
  const device =
    /iPad|Tablet/.test(ua) ? 'tablet'
    : /Mobi|iPhone|Android.*Mobile/.test(ua) ? 'mobile'
    : ua ? 'desktop' : 'other';
  return { browser, os, device };
}

const round1 = (v: string | null) => {
  if (v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? Math.round(n * 10) / 10 : null;
};

/** Pull geography + device out of the request (CloudFront headers + UA). */
export function clientContext(req: Request): ClientContext {
  const h = (name: string): string | null => {
    const v = req.headers[name];
    return typeof v === 'string' && v !== '' ? v : null;
  };
  // CloudFront-Viewer-Address is "ip:port" (v6 uses trailing :port too).
  const addr = h('cloudfront-viewer-address');
  const ip = addr ? addr.slice(0, addr.lastIndexOf(':')) : (h('x-forwarded-for')?.split(',')[0].trim() ?? null);
  const ua = h('user-agent') ?? '';
  const parsed = parseUserAgent(ua);
  return {
    ip,
    country: h('cloudfront-viewer-country'),
    countryName: h('cloudfront-viewer-country-name'),
    region: h('cloudfront-viewer-country-region-name') ?? h('cloudfront-viewer-country-region'),
    city: h('cloudfront-viewer-city'),
    timeZone: h('cloudfront-viewer-time-zone'),
    asn: h('cloudfront-viewer-asn'),
    lat: round1(h('cloudfront-viewer-latitude')),
    lon: round1(h('cloudfront-viewer-longitude')),
    ...parsed,
    userAgent: ua ? ua.slice(0, 400) : null,
  };
}

/** Record an auth event (fire-and-forget from routes; never throws). */
export async function recordAuthEvent(
  req: Request,
  e: { event: 'register' | 'login' | 'switch'; success: boolean; email: string; userId?: string | null; method?: string }
): Promise<void> {
  if (!process.env.DATABASE_URL) return;
  try {
    const c = clientContext(req);
    let userId = e.userId ?? null;
    if (!userId) {
      const { rows } = await db().query(`SELECT id FROM users WHERE email = $1`, [e.email.toLowerCase()]);
      userId = rows[0]?.id ?? null;
    }
    // New-location check BEFORE inserting this event.
    let isNewCountry = false;
    if (e.success && userId && c.country) {
      const prior = await db().query(
        `SELECT DISTINCT country FROM login_events WHERE user_id = $1 AND success AND country IS NOT NULL`, [userId]);
      isNewCountry = prior.rows.length > 0 && !prior.rows.some((r) => r.country === c.country);
    }
    await db().query(
      `INSERT INTO login_events
         (user_id, email, event, success, method, ip, country, country_name, region, city, time_zone, asn, lat, lon, browser, os, device, user_agent)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)`,
      [userId, e.email, e.event, e.success, e.method ?? 'password',
       c.ip, c.country, c.countryName, c.region, c.city, c.timeZone, c.asn, c.lat, c.lon,
       c.browser, c.os, c.device, c.userAgent]
    );
    if (isNewCountry) {
      const place = [c.city, c.countryName ?? c.country].filter(Boolean).join(', ');
      void sendEmail(e.email, 'New sign-in location on Kunatra',
        `Your Kunatra account just signed in from a new location: ${place || 'unknown'} ` +
        `(${c.browser ?? 'unknown browser'} on ${c.os ?? 'unknown OS'}).\n\n` +
        `If this was you, no action is needed. If not, change your password immediately from Profile.`);
    }
  } catch (err: any) {
    console.error(`[access] record failed: ${err?.message}`);
  }
}

// ---- access heartbeat (last-seen on the account, throttled) -----------------
const lastBeat = new Map<string, number>();
const BEAT_MS = 15 * 60 * 1000;

export async function heartbeat(req: Request): Promise<void> {
  const userId = req.user?.id;
  if (!userId || !process.env.DATABASE_URL) return;
  const now = Date.now();
  if ((lastBeat.get(userId) ?? 0) > now - BEAT_MS) return;
  lastBeat.set(userId, now);
  try {
    const c = clientContext(req);
    await db().query(
      `UPDATE users SET last_seen_at = now(),
              last_country = COALESCE($2, last_country), last_city = COALESCE($3, last_city)
        WHERE id = $1`,
      [userId, c.countryName ?? c.country, c.city]
    );
  } catch (err: any) {
    console.error(`[access] heartbeat failed: ${err?.message}`);
  }
}

/** Retention: sign-in history is kept 180 days, then deleted (privacy page says so). */
export async function purgeOldEvents(): Promise<void> {
  if (!process.env.DATABASE_URL) return;
  try {
    const { rowCount } = await db().query(`DELETE FROM login_events WHERE created_at < now() - interval '180 days'`);
    if (rowCount) console.log(`[access] purged ${rowCount} sign-in event(s) older than 180 days`);
  } catch (e: any) {
    console.error(`[access] purge failed: ${e?.message}`);
  }
}

// ---- reads -------------------------------------------------------------------
const eventRow = (r: any) => ({
  at: r.created_at, event: r.event, success: r.success, method: r.method,
  country: r.country ?? null, countryName: r.country_name ?? null, region: r.region ?? null,
  city: r.city ?? null, timeZone: r.time_zone ?? null, asn: r.asn ?? null,
  lat: r.lat != null ? Number(r.lat) : null, lon: r.lon != null ? Number(r.lon) : null,
  browser: r.browser ?? null, os: r.os ?? null, device: r.device ?? null,
});

/** Your own recent sign-ins (Profile transparency). */
export async function mySignins(userId: string) {
  const { rows } = await db().query(
    `SELECT * FROM login_events WHERE user_id = $1 ORDER BY created_at DESC LIMIT 20`, [userId]);
  return rows.map(eventRow);
}

/** Platform-wide recent sign-ins (admin; identity + place, no financials). */
export async function adminSignins() {
  const { rows } = await db().query(
    `SELECT * FROM login_events ORDER BY created_at DESC LIMIT 50`);
  return rows.map((r) => ({ ...eventRow(r), email: r.email }));
}
