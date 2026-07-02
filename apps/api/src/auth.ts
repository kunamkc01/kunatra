// Authentication & role-based access control.
// Passwords: scrypt (Node crypto). Sessions: compact HS256 tokens (no external deps).
import crypto from 'node:crypto';
import type { Request, Response, NextFunction } from 'express';
import { db, HttpError } from './pool.ts';

const SECRET = process.env.AUTH_SECRET ?? 'dev-insecure-secret-change-me';
const TOKEN_TTL_SEC = 60 * 60 * 24 * 7; // 7 days

export type Role = 'owner' | 'operations' | 'advisor';
const ROLES: Role[] = ['owner', 'operations', 'advisor'];
export interface AuthUser { id: string; householdId: string; role: Role; email: string; }

// Augment Express Request with the authenticated user.
declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request { user?: AuthUser; }
  }
}

// ---- passwords ------------------------------------------------------------

export function hashPassword(pw: string): string {
  if (typeof pw !== 'string' || pw.length < 6) {
    throw new HttpError(400, 'weak_password', 'Password must be at least 6 characters');
  }
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(pw, salt, 64);
  return `${salt.toString('hex')}:${hash.toString('hex')}`;
}

function verifyPassword(pw: string, stored: string): boolean {
  const [saltHex, hashHex] = stored.split(':');
  if (!saltHex || !hashHex) return false;
  const hash = crypto.scryptSync(pw, Buffer.from(saltHex, 'hex'), 64);
  const expected = Buffer.from(hashHex, 'hex');
  return hash.length === expected.length && crypto.timingSafeEqual(hash, expected);
}

// ---- tokens (HS256, JWT-shaped) -------------------------------------------

const b64url = (s: string | Buffer) => Buffer.from(s).toString('base64url');

export function signToken(payload: Record<string, unknown>, ttlSec = TOKEN_TTL_SEC): string {
  const header = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const body = b64url(JSON.stringify({ ...payload, exp: Math.floor(Date.now() / 1000) + ttlSec }));
  const data = `${header}.${body}`;
  const sig = crypto.createHmac('sha256', SECRET).update(data).digest('base64url');
  return `${data}.${sig}`;
}

function verifyToken(token: string): any {
  const parts = token.split('.');
  if (parts.length !== 3) throw new HttpError(401, 'invalid_token');
  const data = `${parts[0]}.${parts[1]}`;
  const expected = crypto.createHmac('sha256', SECRET).update(data).digest('base64url');
  const sig = Buffer.from(parts[2]);
  const exp = Buffer.from(expected);
  if (sig.length !== exp.length || !crypto.timingSafeEqual(sig, exp)) throw new HttpError(401, 'invalid_token');
  const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString());
  if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) throw new HttpError(401, 'token_expired', 'Session expired');
  return payload;
}

// ---- user data ------------------------------------------------------------

const userRow = (r: any) => ({
  id: r.id, householdId: r.household_id, email: r.email, fullName: r.full_name ?? null,
  role: r.role as Role, avatar: r.avatar ?? null, createdAt: r.created_at,
});

const MAX_AVATAR = 700_000; // ~500KB image as a data URL
function avatarOrNull(v: unknown): string | null {
  if (v == null || v === '') return null;
  if (typeof v !== 'string' || !v.startsWith('data:image/')) throw new HttpError(400, 'invalid_input', 'avatar must be an image data URL');
  if (v.length > MAX_AVATAR) throw new HttpError(400, 'avatar_too_large', 'Please choose a smaller image');
  return v;
}

const normEmail = (e: unknown) => {
  if (typeof e !== 'string' || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e.trim())) {
    throw new HttpError(400, 'invalid_email', 'A valid email is required');
  }
  return e.trim().toLowerCase();
};

/** Register a new owner: creates the household and the owner user in one transaction. */
export async function register(body: any) {
  const email = normEmail(body.email);
  const passwordHash = hashPassword(body.password);
  const fullName = typeof body.fullName === 'string' ? body.fullName.trim() : null;
  const householdName = (typeof body.householdName === 'string' && body.householdName.trim()) || 'My household';

  const client = await db().connect();
  try {
    await client.query('BEGIN');
    const dup = await client.query(`SELECT 1 FROM users WHERE email = $1`, [email]);
    if (dup.rowCount) throw new HttpError(409, 'email_taken', 'That email is already registered');

    const hh = await client.query(
      `INSERT INTO households (display_name, monthly_take_home_paise, monthly_essential_paise)
       VALUES ($1,$2,$3) RETURNING id`,
      [
        householdName,
        body.monthlyTakeHome ? Math.round(Number(body.monthlyTakeHome) * 100) : null,
        body.monthlyEssential ? Math.round(Number(body.monthlyEssential) * 100) : null,
      ]
    );
    const householdId = hh.rows[0].id;
    const u = await client.query(
      `INSERT INTO users (household_id, email, password_hash, full_name, role)
       VALUES ($1,$2,$3,$4,'owner') RETURNING *`,
      [householdId, email, passwordHash, fullName]
    );
    await client.query('COMMIT');
    const user = userRow(u.rows[0]);
    return { token: tokenFor(user), user };
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}

export async function login(body: any) {
  const email = normEmail(body.email);
  const { rows } = await db().query(`SELECT * FROM users WHERE email = $1`, [email]);
  const row = rows[0];
  if (!row || !verifyPassword(String(body.password ?? ''), row.password_hash)) {
    throw new HttpError(401, 'bad_credentials', 'Email or password is incorrect');
  }
  const user = userRow(row);
  return { token: tokenFor(user), user };
}

function tokenFor(user: { id: string; householdId: string; role: Role; email: string }) {
  return signToken({ sub: user.id, hh: user.householdId, role: user.role, email: user.email });
}

/** Update the caller's own profile (name, avatar). */
export async function updateProfile(userId: string, body: any) {
  const sets: string[] = [];
  const vals: any[] = [];
  const push = (c: string, v: any) => { vals.push(v); sets.push(`${c} = $${vals.length}`); };
  if ('fullName' in body) push('full_name', typeof body.fullName === 'string' ? body.fullName.trim() || null : null);
  if ('avatar' in body) push('avatar', avatarOrNull(body.avatar));
  if (sets.length === 0) return getUserById(userId);
  vals.push(userId);
  const { rows } = await db().query(`UPDATE users SET ${sets.join(', ')} WHERE id = $${vals.length} RETURNING *`, vals);
  if (rows.length === 0) throw new HttpError(404, 'user_not_found');
  return userRow(rows[0]);
}

/** Change your own password (needs the current one). */
export async function changePassword(userId: string, body: any) {
  const { rows } = await db().query(`SELECT password_hash FROM users WHERE id = $1`, [userId]);
  if (rows.length === 0) throw new HttpError(404, 'user_not_found');
  if (!verifyPassword(String(body.currentPassword ?? ''), rows[0].password_hash)) {
    throw new HttpError(400, 'bad_password', 'Your current password is incorrect');
  }
  await db().query(`UPDATE users SET password_hash = $2 WHERE id = $1`, [userId, hashPassword(body.newPassword)]);
  return { ok: true };
}

/** Owner sets a teammate's password directly. */
export async function setPassword(userId: string, newPassword: string) {
  const { rowCount } = await db().query(`UPDATE users SET password_hash = $2 WHERE id = $1`, [userId, hashPassword(newPassword)]);
  if (rowCount === 0) throw new HttpError(404, 'user_not_found');
  return { ok: true };
}

/**
 * Begin a forgot-password flow. Always returns ok (never reveals whether the email
 * exists). No email server is wired up yet — the reset link is logged to the API
 * console; swap in an email provider here later.
 */
export async function requestReset(body: any) {
  try {
    const email = normEmail(body.email);
    const { rows } = await db().query(`SELECT id FROM users WHERE email = $1`, [email]);
    if (rows.length) {
      const token = signToken({ sub: rows[0].id, purpose: 'reset' }, 60 * 60); // 1 hour
      // TODO: send this via email. For now, log it.
      console.log(`[password-reset] ${email} → /reset?token=${token}`);
    }
  } catch { /* ignore — still return ok so we don't leak which emails exist */ }
  return { ok: true };
}

/** Complete a forgot-password flow with a reset token. */
export async function resetWithToken(body: any) {
  let payload: any;
  try { payload = verifyToken(String(body.token ?? '')); }
  catch { throw new HttpError(400, 'invalid_or_expired', 'This reset link is invalid or has expired'); }
  if (payload.purpose !== 'reset') throw new HttpError(400, 'invalid_or_expired', 'This reset link is invalid or has expired');
  return setPassword(payload.sub, body.newPassword);
}

export async function getUserById(id: string) {
  const { rows } = await db().query(`SELECT * FROM users WHERE id = $1`, [id]);
  if (rows.length === 0) throw new HttpError(404, 'user_not_found');
  return userRow(rows[0]);
}

export async function listUsers(householdId: string) {
  const { rows } = await db().query(
    `SELECT * FROM users WHERE household_id = $1 ORDER BY role, email`, [householdId]);
  return rows.map(userRow);
}

/** Owner adds a teammate (owner or operations) to their household. */
export async function createUser(householdId: string, body: any) {
  const email = normEmail(body.email);
  const passwordHash = hashPassword(body.password);
  const role: Role = ROLES.includes(body.role) ? body.role : 'operations';
  const fullName = typeof body.fullName === 'string' ? body.fullName.trim() : null;
  try {
    const { rows } = await db().query(
      `INSERT INTO users (household_id, email, password_hash, full_name, role)
       VALUES ($1,$2,$3,$4,$5) RETURNING *`,
      [householdId, email, passwordHash, fullName, role]
    );
    return userRow(rows[0]);
  } catch (e: any) {
    if (e?.code === '23505') throw new HttpError(409, 'email_taken', 'That email is already registered');
    throw e;
  }
}

export async function deleteUser(id: string) {
  const { rowCount } = await db().query(`DELETE FROM users WHERE id = $1`, [id]);
  if (rowCount === 0) throw new HttpError(404, 'user_not_found');
}

// ---- middleware -----------------------------------------------------------

/** Require a valid bearer token; attaches req.user. */
export function authenticate(req: Request, _res: Response, next: NextFunction) {
  const header = req.headers.authorization ?? '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return next(new HttpError(401, 'unauthenticated', 'Sign in to continue'));
  try {
    const p = verifyToken(token);
    if (p.purpose) return next(new HttpError(401, 'invalid_token')); // e.g. a reset token can't be a session
    req.user = { id: p.sub, householdId: p.hh, role: p.role, email: p.email ?? '' };
    next();
  } catch (e) {
    next(e);
  }
}

/** Restrict to specific roles. */
export function requireRole(...roles: Role[]) {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (!req.user) return next(new HttpError(401, 'unauthenticated'));
    if (!roles.includes(req.user.role)) return next(new HttpError(403, 'forbidden', 'Your role does not have access to this'));
    next();
  };
}

/** For /households/:id/... routes — the path household must be the caller's. */
export function sameHousehold(req: Request, _res: Response, next: NextFunction) {
  if (!req.user) return next(new HttpError(401, 'unauthenticated'));
  if (req.params.id !== req.user.householdId) return next(new HttpError(403, 'forbidden', 'Not your household'));
  next();
}

/** For resource-by-id routes — the resource must belong to the caller's household. */
export function scopeResource(table: string) {
  return async (req: Request, _res: Response, next: NextFunction) => {
    try {
      if (!req.user) throw new HttpError(401, 'unauthenticated');
      const { rows } = await db().query(`SELECT household_id FROM ${table} WHERE id = $1`, [req.params.id]);
      if (rows.length === 0) throw new HttpError(404, 'not_found');
      if (rows[0].household_id !== req.user.householdId) throw new HttpError(403, 'forbidden');
      next();
    } catch (e) {
      next(e);
    }
  };
}

/** Like scopeResource but for resources reached via a join (sql must select household_id for :id). */
export function scopeVia(sql: string) {
  return async (req: Request, _res: Response, next: NextFunction) => {
    try {
      if (!req.user) throw new HttpError(401, 'unauthenticated');
      const { rows } = await db().query(sql, [req.params.id]);
      if (rows.length === 0) throw new HttpError(404, 'not_found');
      if (rows[0].household_id !== req.user.householdId) throw new HttpError(403, 'forbidden');
      next();
    } catch (e) {
      next(e);
    }
  };
}
