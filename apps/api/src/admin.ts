// Platform ("god") view for the app operator. Deliberately COUNTS and identity
// only — never household money, asset values, or property details. Those stay
// private to each household even from an admin.
import { db } from './pool.ts';

export async function platformStats() {
  const { rows } = await db().query(`
    SELECT
      (SELECT count(*) FROM users)                                                   AS users,
      (SELECT count(*) FROM households)                                              AS households,
      (SELECT count(*) FROM members)                                                 AS people,
      (SELECT count(*) FROM assets)                                                  AS assets,
      (SELECT count(*) FROM assets WHERE asset_class = 'real_estate')                AS properties,
      (SELECT count(*) FROM assets WHERE monthly_rent_paise > 0)                     AS rented_properties,
      (SELECT count(*) FROM loans)                                                   AS loans,
      (SELECT count(*) FROM vendors)                                                 AS vendors,
      (SELECT count(*) FROM work_orders)                                             AS work_orders,
      (SELECT count(*) FROM users WHERE created_at > now() - interval '7 days')      AS new_users_7d,
      (SELECT count(*) FROM users WHERE created_at > now() - interval '30 days')     AS new_users_30d,
      (SELECT count(DISTINCT household_id) FROM assets)                              AS active_households
  `);
  const r = rows[0];
  const n = (v: any) => Number(v);
  return {
    users: n(r.users), households: n(r.households), people: n(r.people),
    assets: n(r.assets), properties: n(r.properties), rentedProperties: n(r.rented_properties),
    loans: n(r.loans), vendors: n(r.vendors), workOrders: n(r.work_orders),
    newUsers7d: n(r.new_users_7d), newUsers30d: n(r.new_users_30d), activeHouseholds: n(r.active_households),
  };
}

/** Weekly counts for the last 8 weeks (for the growth charts). */
async function byWeek(table: string) {
  const { rows } = await db().query(`
    SELECT to_char(date_trunc('week', created_at), 'YYYY-MM-DD') AS week, count(*) AS n
      FROM ${table} WHERE created_at > now() - interval '8 weeks'
     GROUP BY 1 ORDER BY 1`);
  return rows.map((r) => ({ week: r.week, count: Number(r.n) }));
}
export const signupsByWeek = () => byWeek('users');
export const assetsByWeek = () => byWeek('assets');

/**
 * A recent platform activity feed — new users, households and assets. Metadata
 * only: an asset event shows its class and time, never its value, name or which
 * household it belongs to. That keeps holdings private even from an admin.
 */
export async function recentActivity() {
  const { rows } = await db().query(`
    SELECT at, type, detail FROM (
      (SELECT created_at AS at, 'user'::text AS type, email::text AS detail FROM users ORDER BY created_at DESC LIMIT 20)
      UNION ALL
      (SELECT created_at, 'household'::text, display_name::text FROM households ORDER BY created_at DESC LIMIT 20)
      UNION ALL
      (SELECT created_at, 'asset'::text, asset_class::text FROM assets ORDER BY created_at DESC LIMIT 30)
    ) e ORDER BY at DESC LIMIT 40`);
  return rows.map((r) => ({ at: r.at, type: r.type as 'user' | 'household' | 'asset', detail: r.detail as string }));
}

/** All users, with identity + membership shape only — no financials. */
export async function listAllUsers() {
  const { rows } = await db().query(`
    SELECT u.id, u.email, u.full_name, u.phone, u.created_at,
           count(DISTINCT m.household_id) AS household_count,
           coalesce(array_agg(DISTINCT m.role) FILTER (WHERE m.role IS NOT NULL), '{}') AS roles
      FROM users u LEFT JOIN memberships m ON m.user_id = u.id
     GROUP BY u.id ORDER BY u.created_at DESC`);
  return rows.map((r) => ({
    id: r.id, email: r.email, fullName: r.full_name ?? null, phone: r.phone ?? null,
    createdAt: r.created_at, householdCount: Number(r.household_count),
    roles: (r.roles as string[]).filter(Boolean),
  }));
}
