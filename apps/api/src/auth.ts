// Authentication & role-based access control.
// Passwords: scrypt (Node crypto). Sessions: compact HS256 tokens (no external deps).
import crypto from 'node:crypto';
import type { Request, Response, NextFunction } from 'express';
import { db, HttpError } from './pool.ts';
import { sendEmail, appUrl, roleBlurb } from './notify.ts';

const SECRET = process.env.AUTH_SECRET ?? 'dev-insecure-secret-change-me';
const TOKEN_TTL_SEC = 60 * 60 * 24 * 7; // 7 days

// Platform admins (the app operator) — an env allowlist, so it can't be granted
// from inside a tenant. Admins see platform-wide counts, never household money.
const ADMIN_EMAILS = (process.env.ADMIN_EMAILS ?? '').split(',').map((e) => e.trim().toLowerCase()).filter(Boolean);
export const isAdminEmail = (email: string) => ADMIN_EMAILS.includes((email ?? '').toLowerCase());

export type Role = 'owner' | 'manager' | 'member' | 'operations' | 'advisor';
const ROLES: Role[] = ['owner', 'manager', 'member', 'operations', 'advisor'];
export interface AuthUser { id: string; householdId: string; role: Role; email: string; memberId: string | null; }

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
  role: r.role as Role, avatar: r.avatar ?? null, phone: r.phone ?? null, createdAt: r.created_at,
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
  const phone = typeof body.phone === 'string' ? body.phone.trim() || null : null;
  // Default the household to the person's name — renameable any time (Profile).
  const firstName = (fullName ?? '').trim().split(/\s+/)[0];
  const householdName = (typeof body.householdName === 'string' && body.householdName.trim())
    || (firstName ? `${firstName}'s household` : 'My household');

  const client = await db().connect();
  try {
    await client.query('BEGIN');
    const dup = await client.query(`SELECT 1 FROM users WHERE email = $1`, [email]);
    if (dup.rowCount) throw new HttpError(409, 'email_taken', 'That email is already registered');

    // People earn and spend; the household holds only the SHARED essentials.
    const hh = await client.query(
      `INSERT INTO households (display_name, monthly_essential_paise)
       VALUES ($1,$2) RETURNING id`,
      [householdName, body.monthlyEssential ? Math.round(Number(body.monthlyEssential) * 100) : null]
    );
    const householdId = hh.rows[0].id;
    const u = await client.query(
      `INSERT INTO users (household_id, email, password_hash, full_name, phone, role)
       VALUES ($1,$2,$3,$4,$5,'owner') RETURNING id`,
      [householdId, email, passwordHash, fullName, phone]
    );
    // The registrant IS a person in the household — their take-home lives on
    // their own member record, and their login links to it.
    const personName = fullName || email.split('@')[0];
    const person = await client.query(
      `INSERT INTO members (household_id, name, monthly_gross_paise) VALUES ($1,$2,$3) RETURNING id`,
      [householdId, personName, body.monthlyTakeHome ? Math.round(Number(body.monthlyTakeHome) * 100) : null]
    );
    await client.query(`INSERT INTO memberships (user_id, household_id, role, member_id) VALUES ($1,$2,'owner',$3)`,
      [u.rows[0].id, householdId, person.rows[0].id]);
    await client.query('COMMIT');
    // Welcome the new owner (best-effort; never blocks signup).
    void sendEmail(email, 'Welcome to Kunatra',
      `Hi${fullName ? ' ' + fullName : ''}, welcome to Kunatra — a mirror for your money.\n\n` +
      `You've created the household "${householdName}". ${roleBlurb('owner')}\n\n` +
      `Your Portfolio has a short checklist to build your mirror — add what you own, complete your ` +
      `property details (that unlocks free AI value estimates), and invite your family.\n\n` +
      `Get started: ${appUrl}\n\n` +
      `Kunatra shows you where you stand — it never tells you what to buy, sell or borrow.`);
    return session(u.rows[0].id, householdId);
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
  // Land on your OWN finances first: a household you own, falling back to the
  // home household (e.g. you were invited as a manager and own nothing yet).
  const owned = await db().query(
    `SELECT household_id FROM memberships WHERE user_id = $1 AND role = 'owner' ORDER BY created_at LIMIT 1`, [row.id]);
  return session(row.id, owned.rows[0]?.household_id ?? row.household_id);
}

/** Switch the active household (must be one the user is a member of). */
export async function switchHousehold(userId: string, body: any) {
  const hh = typeof body.householdId === 'string' ? body.householdId : '';
  const m = await resolveMembership(userId, hh);
  if (!m) throw new HttpError(403, 'forbidden', 'No access to that household');
  return session(userId, hh);
}

/** Create a brand-new household owned by the caller, and switch to it. */
export async function createHousehold(userId: string, body: any) {
  const name = (typeof body.displayName === 'string' && body.displayName.trim()) || 'My household';
  const client = await db().connect();
  try {
    await client.query('BEGIN');
    const hh = await client.query(
      `INSERT INTO households (display_name, monthly_essential_paise) VALUES ($1,$2) RETURNING id`,
      [name, body.monthlyEssential ? Math.round(Number(body.monthlyEssential) * 100) : null]
    );
    // The creator is a person in their new household too (salary goes on them).
    const who = await client.query(`SELECT full_name, email FROM users WHERE id = $1`, [userId]);
    const personName = who.rows[0]?.full_name || (who.rows[0]?.email ?? 'Me').split('@')[0];
    const person = await client.query(
      `INSERT INTO members (household_id, name, monthly_gross_paise) VALUES ($1,$2,$3) RETURNING id`,
      [hh.rows[0].id, personName, body.monthlyTakeHome ? Math.round(Number(body.monthlyTakeHome) * 100) : null]
    );
    await client.query(`INSERT INTO memberships (user_id, household_id, role, member_id) VALUES ($1,$2,'owner',$3)`,
      [userId, hh.rows[0].id, person.rows[0].id]);
    await client.query('COMMIT');
    return session(userId, hh.rows[0].id);
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}

const tokenFor = (userId: string, householdId: string, email: string) =>
  signToken({ sub: userId, hh: householdId, email });

/** The households a user can access, with their role in each. */
export async function membershipsFor(userId: string) {
  const { rows } = await db().query(
    `SELECT m.household_id, h.display_name, m.role, m.member_id
       FROM memberships m JOIN households h ON h.id = m.household_id
      WHERE m.user_id = $1 ORDER BY (m.role = 'owner') DESC, m.created_at`, [userId]);
  return rows.map((r) => ({ householdId: r.household_id, householdName: r.display_name, role: r.role as Role, memberId: r.member_id ?? null }));
}

async function resolveMembership(userId: string, householdId: string): Promise<{ role: Role; memberId: string | null } | null> {
  const { rows } = await db().query(`SELECT role, member_id FROM memberships WHERE user_id = $1 AND household_id = $2`, [userId, householdId]);
  return rows[0] ? { role: rows[0].role as Role, memberId: rows[0].member_id ?? null } : null;
}

/** Build a login/switch response: token + user (with active household + role) + the households list. */
async function session(userId: string, householdId: string) {
  const households = await membershipsFor(userId);
  if (households.length === 0) throw new HttpError(403, 'no_access', 'No household access');
  const active = households.find((h) => h.householdId === householdId) ?? households[0];
  const { rows } = await db().query(`SELECT * FROM users WHERE id = $1`, [userId]);
  const base = userRow(rows[0]);
  const user = { id: base.id, email: base.email, fullName: base.fullName, avatar: base.avatar, phone: base.phone,
    householdId: active.householdId, role: active.role, memberId: active.memberId, households, isAdmin: isAdminEmail(base.email) };
  return { token: tokenFor(userId, active.householdId, base.email), user };
}

/** The current session's user, resolved for the active household. */
export async function me(u: AuthUser) {
  const s = await session(u.id, u.householdId);
  return s.user;
}

/** Update the caller's own profile (name, avatar). */
export async function updateProfile(userId: string, body: any) {
  const sets: string[] = [];
  const vals: any[] = [];
  const push = (c: string, v: any) => { vals.push(v); sets.push(`${c} = $${vals.length}`); };
  if ('fullName' in body) push('full_name', typeof body.fullName === 'string' ? body.fullName.trim() || null : null);
  if ('phone' in body) push('phone', typeof body.phone === 'string' ? body.phone.trim() || null : null);
  if ('avatar' in body) push('avatar', avatarOrNull(body.avatar));
  if (sets.length === 0) {
    const { rows } = await db().query(`SELECT * FROM users WHERE id = $1`, [userId]);
    if (rows.length === 0) throw new HttpError(404, 'user_not_found');
    return userRow(rows[0]);
  }
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
 * exists). Emails a one-hour reset link via SES (logs it if SES isn't configured).
 */
export async function requestReset(body: any) {
  try {
    const email = normEmail(body.email);
    const { rows } = await db().query(`SELECT id FROM users WHERE email = $1`, [email]);
    if (rows.length) {
      const token = signToken({ sub: rows[0].id, purpose: 'reset' }, 60 * 60); // 1 hour
      const link = `${appUrl}/reset?token=${token}`;
      await sendEmail(email, 'Reset your Kunatra password',
        `Someone asked to reset the password for your Kunatra account.\n\nReset it here (valid for 1 hour):\n${link}\n\nIf this wasn't you, you can ignore this email.`);
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

/** Everyone with access to a household, with their role (and person, for members). */
export async function listUsers(householdId: string) {
  const { rows } = await db().query(
    `SELECT u.id AS user_id, u.email, u.full_name, u.avatar, m.role, m.member_id, mem.name AS member_name
       FROM memberships m JOIN users u ON u.id = m.user_id
       LEFT JOIN members mem ON mem.id = m.member_id
      WHERE m.household_id = $1 ORDER BY m.role, u.email`, [householdId]);
  return rows.map((r) => ({
    id: r.user_id, email: r.email, fullName: r.full_name ?? null, avatar: r.avatar ?? null,
    role: r.role as Role, memberId: r.member_id ?? null, memberName: r.member_name ?? null,
  }));
}

/**
 * Grant someone access to a household. Existing users just get a new membership
 * (so one login can span households); new emails get an account created too.
 */
export async function createUser(householdId: string, body: any) {
  const email = normEmail(body.email);
  const role: Role = ROLES.includes(body.role) ? body.role : 'operations';
  const fullName = typeof body.fullName === 'string' ? body.fullName.trim() : null;
  const memberId = role === 'member' && typeof body.memberId === 'string' && body.memberId ? body.memberId : null;
  if (role === 'member' && !memberId) throw new HttpError(400, 'invalid_input', 'A member login must be linked to a person');
  if (memberId) {
    const mm = await db().query(`SELECT 1 FROM members WHERE id = $1 AND household_id = $2`, [memberId, householdId]);
    if (!mm.rowCount) throw new HttpError(400, 'invalid_input', 'That person is not in this household');
  }

  const client = await db().connect();
  try {
    await client.query('BEGIN');
    const existing = await client.query(`SELECT id FROM users WHERE email = $1`, [email]);
    let userId: string;
    let isNew = false;
    if (existing.rowCount) {
      userId = existing.rows[0].id;
    } else {
      const pw = hashPassword(body.password); // required (and length-checked) for new accounts
      const u = await client.query(
        `INSERT INTO users (household_id, email, password_hash, full_name, role) VALUES ($1,$2,$3,$4,$5) RETURNING id`,
        [householdId, email, pw, fullName, role]
      );
      userId = u.rows[0].id;
      isNew = true;
    }
    await client.query(`INSERT INTO memberships (user_id, household_id, role, member_id) VALUES ($1,$2,$3,$4)`, [userId, householdId, role, memberId]);
    const hh = await client.query(`SELECT display_name FROM households WHERE id = $1`, [householdId]);
    await client.query('COMMIT');
    // Let them know they've been given access (best-effort; never blocks the grant).
    const place = hh.rows[0]?.display_name ?? 'a household';
    const signin = isNew
      ? `Sign in at ${appUrl}/login with this email and the temporary password your admin shared, then change it under Profile.`
      : `It's on your existing account — sign in at ${appUrl}/login and switch to it from the household menu.`;
    void sendEmail(email, `You've been given ${role} access on Kunatra`,
      `You've been added to "${place}" on Kunatra as ${role}.\n\n${roleBlurb(role)}\n\n${signin}`);
    return { ok: true, userId };
  } catch (e: any) {
    await client.query('ROLLBACK');
    if (e?.code === '23505') throw new HttpError(409, 'already_member', 'That person already has access to this household');
    throw e;
  } finally {
    client.release();
  }
}

/** Revoke a user's access to one household (removes the membership, keeps their account). */
export async function deleteUser(userId: string, householdId: string) {
  const { rowCount } = await db().query(`DELETE FROM memberships WHERE user_id = $1 AND household_id = $2`, [userId, householdId]);
  if (rowCount === 0) throw new HttpError(404, 'not_a_member');
}

// ---- middleware -----------------------------------------------------------

/** Require a valid bearer token; resolves the caller's role in the active household. */
export async function authenticate(req: Request, _res: Response, next: NextFunction) {
  const header = req.headers.authorization ?? '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return next(new HttpError(401, 'unauthenticated', 'Sign in to continue'));
  try {
    const p = verifyToken(token);
    if (p.purpose) throw new HttpError(401, 'invalid_token'); // e.g. a reset token can't be a session
    const m = await resolveMembership(p.sub, p.hh);
    if (!m) throw new HttpError(401, 'invalid_token', 'No access to that household');
    req.user = { id: p.sub, householdId: p.hh, role: m.role, email: p.email ?? '', memberId: m.memberId };
    next();
  } catch (e) {
    next(e);
  }
}

/** Platform-admin only (the app operator), by email allowlist. */
export function requireAdmin(req: Request, _res: Response, next: NextFunction) {
  if (!req.user) return next(new HttpError(401, 'unauthenticated'));
  if (!isAdminEmail(req.user.email)) return next(new HttpError(403, 'forbidden', 'Admin only'));
  next();
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

/**
 * For assets/loans (which carry member_id): scope to the caller's household, and —
 * for a 'member' login — to their own person's items only.
 */
export function scopeOwned(table: string) {
  return async (req: Request, _res: Response, next: NextFunction) => {
    try {
      if (!req.user) throw new HttpError(401, 'unauthenticated');
      const { rows } = await db().query(`SELECT household_id, member_id FROM ${table} WHERE id = $1`, [req.params.id]);
      if (rows.length === 0) throw new HttpError(404, 'not_found');
      if (rows[0].household_id !== req.user.householdId) throw new HttpError(403, 'forbidden');
      if (req.user.role === 'member' && rows[0].member_id !== req.user.memberId) {
        throw new HttpError(403, 'not_yours', 'You can only manage your own items');
      }
      next();
    } catch (e) {
      next(e);
    }
  };
}

/** A 'member' login can only create items attributed to their own person. */
export function forceMemberOwnership(req: Request, _res: Response, next: NextFunction) {
  if (req.user?.role === 'member') req.body = { ...req.body, memberId: req.user.memberId };
  next();
}

/** A 'member' login can only edit their own person record; owners/managers, anyone. */
export function memberSelfOnly(req: Request, _res: Response, next: NextFunction) {
  if (req.user?.role === 'member' && req.params.id !== req.user.memberId) {
    return next(new HttpError(403, 'not_yours', 'You can only edit your own details'));
  }
  next();
}

/**
 * Like scopeOwned but for a resource reached via a join — sql must select
 * household_id AND member_id for :id (member_id may be null). Used for e.g.
 * an asset photo, where ownership follows the parent asset's member.
 */
export function scopeOwnedVia(sql: string) {
  return async (req: Request, _res: Response, next: NextFunction) => {
    try {
      if (!req.user) throw new HttpError(401, 'unauthenticated');
      const { rows } = await db().query(sql, [req.params.id]);
      if (rows.length === 0) throw new HttpError(404, 'not_found');
      if (rows[0].household_id !== req.user.householdId) throw new HttpError(403, 'forbidden');
      if (req.user.role === 'member' && rows[0].member_id !== req.user.memberId) {
        throw new HttpError(403, 'not_yours', 'You can only manage your own items');
      }
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
