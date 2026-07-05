import type { AssetClass } from '@atlas/engine';
import { db, rupeesToPaise, paiseToRupees, HttpError } from './pool.ts';

// ---- shared validation helpers -------------------------------------------

const ASSET_CLASSES: AssetClass[] = [
  'real_estate', 'mutual_fund', 'sip', 'equity', 'epf', 'ppf', 'nps', 'fd', 'rd', 'bonds', 'cash', 'gold', 'insurance', 'other',
];

function str(v: unknown, field: string, { required = false } = {}): string | undefined {
  if (v == null || v === '') {
    if (required) throw new HttpError(400, 'invalid_input', `${field} is required`);
    return undefined;
  }
  if (typeof v !== 'string') throw new HttpError(400, 'invalid_input', `${field} must be a string`);
  return v.trim();
}

function money(v: unknown, field: string, { required = false } = {}): number | undefined {
  if (v == null || v === '') {
    if (required) throw new HttpError(400, 'invalid_input', `${field} is required`);
    return undefined;
  }
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0) throw new HttpError(400, 'invalid_input', `${field} must be a non-negative number`);
  return n;
}

function bool(v: unknown): boolean | undefined {
  if (v == null) return undefined;
  return Boolean(v);
}

function year(v: unknown, field: string): number | null {
  if (v == null || v === '') return null;
  const n = Number(v);
  if (!Number.isInteger(n) || n < 1900 || n > 2100) throw new HttpError(400, 'invalid_input', `${field} must be a 4-digit year`);
  return n;
}

function assetClass(v: unknown): AssetClass {
  if (!ASSET_CLASSES.includes(v as AssetClass)) {
    throw new HttpError(400, 'invalid_input', `assetClass must be one of: ${ASSET_CLASSES.join(', ')}`);
  }
  return v as AssetClass;
}

// ---- households -----------------------------------------------------------

const householdRow = (r: any) => ({
  id: r.id,
  displayName: r.display_name,
  monthlyTakeHome: r.monthly_take_home_paise != null ? paiseToRupees(r.monthly_take_home_paise) : null,
  monthlyEssential: r.monthly_essential_paise != null ? paiseToRupees(r.monthly_essential_paise) : null,
  createdAt: r.created_at,
});

export async function createHousehold(body: any) {
  const displayName = str(body.displayName, 'displayName', { required: true });
  const takeHome = money(body.monthlyTakeHome, 'monthlyTakeHome');
  const essential = money(body.monthlyEssential, 'monthlyEssential');
  const { rows } = await db().query(
    `INSERT INTO households (display_name, monthly_take_home_paise, monthly_essential_paise)
     VALUES ($1, $2, $3) RETURNING *`,
    [displayName, takeHome != null ? rupeesToPaise(takeHome) : null, essential != null ? rupeesToPaise(essential) : null]
  );
  return householdRow(rows[0]);
}

export async function getHousehold(id: string) {
  const { rows } = await db().query(`SELECT * FROM households WHERE id = $1`, [id]);
  if (rows.length === 0) throw new HttpError(404, 'household_not_found');
  return householdRow(rows[0]);
}

export async function updateHousehold(id: string, body: any) {
  const sets: string[] = [];
  const vals: any[] = [];
  const push = (col: string, val: any) => { vals.push(val); sets.push(`${col} = $${vals.length}`); };

  if ('displayName' in body) push('display_name', str(body.displayName, 'displayName', { required: true }));
  if ('monthlyTakeHome' in body) {
    const v = money(body.monthlyTakeHome, 'monthlyTakeHome');
    push('monthly_take_home_paise', v != null ? rupeesToPaise(v) : null);
  }
  if ('monthlyEssential' in body) {
    const v = money(body.monthlyEssential, 'monthlyEssential');
    push('monthly_essential_paise', v != null ? rupeesToPaise(v) : null);
  }
  if (sets.length === 0) return getHousehold(id);

  vals.push(id);
  const { rows } = await db().query(
    `UPDATE households SET ${sets.join(', ')} WHERE id = $${vals.length} RETURNING *`,
    vals
  );
  if (rows.length === 0) throw new HttpError(404, 'household_not_found');
  return householdRow(rows[0]);
}

export async function deleteHousehold(id: string) {
  const { rowCount } = await db().query(`DELETE FROM households WHERE id = $1`, [id]);
  if (rowCount === 0) throw new HttpError(404, 'household_not_found');
}

// ---- members (family members with their own income) -----------------------

const memberRow = (r: any) => {
  const gross = r.monthly_gross_paise != null ? paiseToRupees(r.monthly_gross_paise) : null;
  const tds = r.monthly_tds_paise != null ? paiseToRupees(r.monthly_tds_paise) : null;
  return {
    id: r.id,
    householdId: r.household_id,
    name: r.name,
    monthlyGross: gross,
    monthlyTds: tds,
    monthlyNet: gross != null ? gross - (tds ?? 0) : null, // take-home
    // Personal monthly spend — adds on top of the household's shared essentials.
    monthlyExpenses: r.monthly_essential_paise != null ? paiseToRupees(r.monthly_essential_paise) : null,
    createdAt: r.created_at,
  };
};

export async function listMembers(householdId: string) {
  await getHousehold(householdId);
  const { rows } = await db().query(`SELECT * FROM members WHERE household_id = $1 ORDER BY created_at`, [householdId]);
  return rows.map(memberRow);
}

export async function createMember(householdId: string, body: any) {
  await getHousehold(householdId);
  const gross = money(body.monthlyGross, 'monthlyGross');
  const tds = money(body.monthlyTds, 'monthlyTds');
  const expenses = money(body.monthlyExpenses, 'monthlyExpenses');
  const { rows } = await db().query(
    `INSERT INTO members (household_id, name, monthly_gross_paise, monthly_tds_paise, monthly_essential_paise)
     VALUES ($1,$2,$3,$4,$5) RETURNING *`,
    [householdId, str(body.name, 'name', { required: true }),
     gross != null ? rupeesToPaise(gross) : null,
     tds != null ? rupeesToPaise(tds) : null,
     expenses != null ? rupeesToPaise(expenses) : null]
  );
  return memberRow(rows[0]);
}

export async function updateMember(id: string, body: any) {
  const sets: string[] = [];
  const vals: any[] = [];
  const push = (c: string, v: any) => { vals.push(v); sets.push(`${c} = $${vals.length}`); };
  if ('name' in body) push('name', str(body.name, 'name', { required: true }));
  if ('monthlyGross' in body) { const v = money(body.monthlyGross, 'monthlyGross'); push('monthly_gross_paise', v != null ? rupeesToPaise(v) : null); }
  if ('monthlyTds' in body) { const v = money(body.monthlyTds, 'monthlyTds'); push('monthly_tds_paise', v != null ? rupeesToPaise(v) : null); }
  if ('monthlyExpenses' in body) { const v = money(body.monthlyExpenses, 'monthlyExpenses'); push('monthly_essential_paise', v != null ? rupeesToPaise(v) : null); }
  if (sets.length === 0) {
    const { rows } = await db().query(`SELECT * FROM members WHERE id = $1`, [id]);
    if (rows.length === 0) throw new HttpError(404, 'member_not_found');
    return memberRow(rows[0]);
  }
  vals.push(id);
  const { rows } = await db().query(`UPDATE members SET ${sets.join(', ')} WHERE id = $${vals.length} RETURNING *`, vals);
  if (rows.length === 0) throw new HttpError(404, 'member_not_found');
  return memberRow(rows[0]);
}

export async function deleteMember(id: string) {
  const { rowCount } = await db().query(`DELETE FROM members WHERE id = $1`, [id]);
  if (rowCount === 0) throw new HttpError(404, 'member_not_found');
}

// ---- assets (with optional real-estate profile) ---------------------------

const assetRow = (r: any) => ({
  id: r.id,
  householdId: r.household_id,
  name: r.name,
  assetClass: r.asset_class,
  value: paiseToRupees(r.current_value_paise),
  liquid: r.liquid,
  parentAssetId: r.parent_asset_id ?? null,
  memberId: r.member_id ?? null,
  costBasis: r.cost_basis_paise != null ? paiseToRupees(r.cost_basis_paise) : null,
  monthlyContribution: r.monthly_contribution_paise != null ? paiseToRupees(r.monthly_contribution_paise) : null,
  monthlyRent: r.monthly_rent_paise != null ? paiseToRupees(r.monthly_rent_paise) : null,
  rentTds: r.monthly_rent_tds_paise != null ? paiseToRupees(r.monthly_rent_tds_paise) : null,
  tenantName: r.tenant_name ?? null,
  acquiredHow: r.acquired_how ?? null,
  acquiredYear: r.acquired_year ?? null,
  realEstate: r.address != null || r.ptin != null || r.sqft != null || r.city != null || r.property_type != null
    ? {
        address: r.address ?? null,
        sqft: r.sqft != null ? Number(r.sqft) : null,
        undividedShare: r.undivided_share ?? null,
        ptin: r.ptin ?? null,
        carPark: r.car_park ?? null,
        carParkSize: r.car_park_size ?? null,
        propertyType: r.property_type ?? null,
        bedrooms: r.bedrooms != null ? Number(r.bedrooms) : null,
        bathrooms: r.bathrooms != null ? Number(r.bathrooms) : null,
        floor: r.floor != null ? Number(r.floor) : null,
        builtYear: r.built_year != null ? Number(r.built_year) : null,
        city: r.city ?? null,
        locality: r.locality ?? null,
      }
    : null,
});

const ASSET_SELECT = `
  SELECT a.*, p.address, p.sqft, p.undivided_share, p.ptin, p.car_park, p.car_park_size, p.property_type, p.bedrooms, p.bathrooms, p.floor, p.built_year, p.city, p.locality
    FROM assets a
    LEFT JOIN real_estate_profiles p ON p.asset_id = a.id`;

export async function listAssets(householdId: string) {
  await getHousehold(householdId); // 404 if missing
  const { rows } = await db().query(`${ASSET_SELECT} WHERE a.household_id = $1 ORDER BY a.current_value_paise DESC`, [householdId]);
  return rows.map(assetRow);
}

export async function getAsset(id: string) {
  const { rows } = await db().query(`${ASSET_SELECT} WHERE a.id = $1`, [id]);
  if (rows.length === 0) throw new HttpError(404, 'asset_not_found');
  return assetRow(rows[0]);
}

async function upsertRealEstate(client: any, assetId: string, re: any) {
  await client.query(
    `INSERT INTO real_estate_profiles (asset_id, address, sqft, undivided_share, ptin, car_park, car_park_size, property_type, bedrooms, bathrooms, floor, built_year, city, locality)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
     ON CONFLICT (asset_id) DO UPDATE SET
       address = EXCLUDED.address, sqft = EXCLUDED.sqft, undivided_share = EXCLUDED.undivided_share,
       ptin = EXCLUDED.ptin, car_park = EXCLUDED.car_park, car_park_size = EXCLUDED.car_park_size,
       property_type = EXCLUDED.property_type, bedrooms = EXCLUDED.bedrooms, bathrooms = EXCLUDED.bathrooms,
       floor = EXCLUDED.floor, built_year = EXCLUDED.built_year, city = EXCLUDED.city, locality = EXCLUDED.locality`,
    [assetId, str(re.address, 'address'), re.sqft != null && re.sqft !== '' ? Number(re.sqft) : null,
     str(re.undividedShare, 'undividedShare'), str(re.ptin, 'ptin'), str(re.carPark, 'carPark'), str(re.carParkSize, 'carParkSize'),
     str(re.propertyType, 'propertyType') ?? null,
     re.bedrooms != null && re.bedrooms !== '' ? Number(re.bedrooms) : null,
     re.bathrooms != null && re.bathrooms !== '' ? Number(re.bathrooms) : null,
     re.floor != null && re.floor !== '' ? Number(re.floor) : null,
     re.builtYear != null && re.builtYear !== '' ? Number(re.builtYear) : null,
     str(re.city, 'city') ?? null, str(re.locality, 'locality') ?? null]
  );
}

export async function createAsset(householdId: string, body: any) {
  await getHousehold(householdId);
  const name = str(body.name, 'name', { required: true });
  const cls = assetClass(body.assetClass);
  const value = money(body.value, 'value', { required: true })!;
  const liquid = bool(body.liquid) ?? false;
  const costBasis = money(body.costBasis, 'costBasis');
  const monthly = money(body.monthlyContribution, 'monthlyContribution');
  const rent = money(body.monthlyRent, 'monthlyRent');
  const rentTds = money(body.rentTds, 'rentTds');

  const client = await db().connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query(
      `INSERT INTO assets (household_id, name, asset_class, current_value_paise, liquid, cost_basis_paise, monthly_contribution_paise, member_id, monthly_rent_paise, acquired_how, acquired_year, monthly_rent_tds_paise, tenant_name)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING id`,
      [householdId, name, cls, rupeesToPaise(value), liquid,
       costBasis != null ? rupeesToPaise(costBasis) : null,
       monthly != null ? rupeesToPaise(monthly) : null,
       str(body.memberId, 'memberId') ?? null,
       rent != null ? rupeesToPaise(rent) : null,
       str(body.acquiredHow, 'acquiredHow') ?? null,
       year(body.acquiredYear, 'acquiredYear'),
       rentTds != null ? rupeesToPaise(rentTds) : null,
       str(body.tenantName, 'tenantName') ?? null]
    );
    const id = rows[0].id;
    if (cls === 'real_estate' && body.realEstate) await upsertRealEstate(client, id, body.realEstate);
    await client.query('COMMIT');
    return getAsset(id);
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}

export async function updateAsset(id: string, body: any) {
  const existing = await getAsset(id);
  const sets: string[] = [];
  const vals: any[] = [];
  const push = (col: string, val: any) => { vals.push(val); sets.push(`${col} = $${vals.length}`); };

  if ('name' in body) push('name', str(body.name, 'name', { required: true }));
  if ('assetClass' in body) push('asset_class', assetClass(body.assetClass));
  if ('value' in body) push('current_value_paise', rupeesToPaise(money(body.value, 'value', { required: true })!));
  if ('liquid' in body) push('liquid', Boolean(body.liquid));
  if ('costBasis' in body) { const m = money(body.costBasis, 'costBasis'); push('cost_basis_paise', m != null ? rupeesToPaise(m) : null); }
  if ('monthlyContribution' in body) { const m = money(body.monthlyContribution, 'monthlyContribution'); push('monthly_contribution_paise', m != null ? rupeesToPaise(m) : null); }
  if ('memberId' in body) push('member_id', str(body.memberId, 'memberId') ?? null);
  if ('monthlyRent' in body) { const m = money(body.monthlyRent, 'monthlyRent'); push('monthly_rent_paise', m != null ? rupeesToPaise(m) : null); }
  if ('rentTds' in body) { const m = money(body.rentTds, 'rentTds'); push('monthly_rent_tds_paise', m != null ? rupeesToPaise(m) : null); }
  if ('tenantName' in body) push('tenant_name', str(body.tenantName, 'tenantName') ?? null);
  if ('acquiredHow' in body) push('acquired_how', str(body.acquiredHow, 'acquiredHow') ?? null);
  if ('acquiredYear' in body) push('acquired_year', year(body.acquiredYear, 'acquiredYear'));

  const client = await db().connect();
  try {
    await client.query('BEGIN');
    if (sets.length > 0) {
      vals.push(id);
      await client.query(`UPDATE assets SET ${sets.join(', ')} WHERE id = $${vals.length}`, vals);
    }
    const cls = (body.assetClass ?? existing.assetClass) as AssetClass;
    if (cls === 'real_estate' && body.realEstate) await upsertRealEstate(client, id, body.realEstate);
    await client.query('COMMIT');
    return getAsset(id);
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}

export async function deleteAsset(id: string) {
  const { rowCount } = await db().query(`DELETE FROM assets WHERE id = $1`, [id]);
  if (rowCount === 0) throw new HttpError(404, 'asset_not_found');
}

// ---- valuations (appreciation over time) ----------------------------------

function dateStr(v: unknown, field: string, { required = false } = {}): string | null {
  if (v == null || v === '') {
    if (required) throw new HttpError(400, 'invalid_input', `${field} is required`);
    return null;
  }
  const s = String(v);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) throw new HttpError(400, 'invalid_input', `${field} must be a date (YYYY-MM-DD)`);
  return s;
}

const valuationRow = (r: any) => ({
  id: r.id, assetId: r.asset_id, value: paiseToRupees(r.value_paise), asOf: r.as_of, source: r.source ?? null,
});

export async function listValuations(assetId: string) {
  const { rows } = await db().query(
    `SELECT * FROM valuations WHERE asset_id = $1 ORDER BY as_of DESC, id DESC`, [assetId]);
  return rows.map(valuationRow);
}

/** Record a dated valuation; the latest (by date) becomes the asset's current value. */
export async function addValuation(assetId: string, body: any) {
  const value = money(body.value, 'value', { required: true })!;
  const asOf = dateStr(body.asOf, 'asOf', { required: true })!;
  const client = await db().connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query(
      `INSERT INTO valuations (asset_id, value_paise, as_of, source) VALUES ($1,$2,$3,$4) RETURNING *`,
      [assetId, rupeesToPaise(value), asOf, str(body.source, 'source') ?? null]
    );
    // Latest valuation drives current value.
    await client.query(
      `UPDATE assets SET current_value_paise = (
         SELECT value_paise FROM valuations WHERE asset_id = $1 ORDER BY as_of DESC, id DESC LIMIT 1
       ) WHERE id = $1`,
      [assetId]
    );
    await client.query('COMMIT');
    return valuationRow(rows[0]);
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}

export async function deleteValuation(id: string) {
  const client = await db().connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query(`DELETE FROM valuations WHERE id = $1 RETURNING asset_id`, [id]);
    if (rows.length === 0) throw new HttpError(404, 'valuation_not_found');
    const assetId = rows[0].asset_id;
    // Fall back to the next latest valuation, if any.
    await client.query(
      `UPDATE assets SET current_value_paise = COALESCE(
         (SELECT value_paise FROM valuations WHERE asset_id = $1 ORDER BY as_of DESC, id DESC LIMIT 1),
         current_value_paise
       ) WHERE id = $1`,
      [assetId]
    );
    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}

// ---- asset photos ---------------------------------------------------------

const MAX_PHOTO = 2_500_000; // ~1.8MB image as a data URL (downscaled client-side)
function photoDataUrl(v: unknown): string {
  if (typeof v !== 'string' || !v.startsWith('data:image/')) throw new HttpError(400, 'invalid_input', 'photo must be an image data URL');
  if (v.length > MAX_PHOTO) throw new HttpError(400, 'photo_too_large', 'Please choose a smaller image');
  return v;
}

const photoRow = (r: any) => ({ id: r.id, assetId: r.asset_id, dataUrl: r.data_url, caption: r.caption ?? null, createdAt: r.created_at });

export async function listPhotos(assetId: string) {
  const { rows } = await db().query(`SELECT * FROM asset_photos WHERE asset_id = $1 ORDER BY created_at, id`, [assetId]);
  return rows.map(photoRow);
}

export async function addPhoto(assetId: string, body: any) {
  const dataUrl = photoDataUrl(body.dataUrl);
  const caption = str(body.caption, 'caption') ?? null;
  const { rows } = await db().query(
    `INSERT INTO asset_photos (asset_id, household_id, data_url, caption)
       SELECT $1, a.household_id, $2, $3 FROM assets a WHERE a.id = $1 RETURNING *`,
    [assetId, dataUrl, caption]
  );
  if (rows.length === 0) throw new HttpError(404, 'asset_not_found');
  return photoRow(rows[0]);
}

export async function deletePhoto(id: string) {
  const { rowCount } = await db().query(`DELETE FROM asset_photos WHERE id = $1`, [id]);
  if (rowCount === 0) throw new HttpError(404, 'photo_not_found');
}

// ---- contributions ledger (drives XIRR) -----------------------------------

/** Signed rupee amount (contributions may be negative = withdrawals). */
function signedMoney(v: unknown, field: string): number {
  const n = Number(v);
  if (v == null || v === '' || !Number.isFinite(n) || n === 0) {
    throw new HttpError(400, 'invalid_input', `${field} must be a non-zero number`);
  }
  return n;
}

const contributionRow = (r: any) => ({
  id: r.id, assetId: r.asset_id, amount: paiseToRupees(r.amount_paise), on: r.contributed_on, note: r.note ?? null,
});

export async function listContributions(assetId: string) {
  const { rows } = await db().query(
    `SELECT * FROM contributions WHERE asset_id = $1 ORDER BY contributed_on ASC, id ASC`, [assetId]);
  return rows.map(contributionRow);
}

export async function addContribution(assetId: string, body: any) {
  const amount = signedMoney(body.amount, 'amount');
  const on = dateStr(body.on, 'on', { required: true })!;
  const { rows } = await db().query(
    `INSERT INTO contributions (asset_id, amount_paise, contributed_on, note) VALUES ($1,$2,$3,$4) RETURNING *`,
    [assetId, rupeesToPaise(amount), on, str(body.note, 'note') ?? null]
  );
  return contributionRow(rows[0]);
}

export async function deleteContribution(id: string) {
  const { rowCount } = await db().query(`DELETE FROM contributions WHERE id = $1`, [id]);
  if (rowCount === 0) throw new HttpError(404, 'contribution_not_found');
}

/** Monthly dates (same day-of-month, clamped) from startOn through untilOn inclusive. */
function monthlySchedule(startOn: string, untilOn: string): string[] {
  const [sy, sm, sd] = startOn.split('-').map(Number);
  const until = new Date(`${untilOn}T00:00:00Z`).getTime();
  const out: string[] = [];
  let y = sy;
  let m = sm;
  for (let i = 0; i < 1200; i++) {
    const dim = new Date(Date.UTC(y, m, 0)).getUTCDate(); // last day of month m
    const day = Math.min(sd, dim);
    const t = Date.UTC(y, m - 1, day);
    if (t > until) break;
    out.push(`${y}-${String(m).padStart(2, '0')}-${String(day).padStart(2, '0')}`);
    m++;
    if (m > 12) { m = 1; y++; }
  }
  return out;
}

/** Generate a recurring SIP as monthly contributions from startOn to today (or `until`). */
export async function addSipSchedule(assetId: string, body: any) {
  const amount = signedMoney(body.amount, 'amount');
  const startOn = dateStr(body.startOn, 'startOn', { required: true })!;
  const until = dateStr(body.until, 'until') ?? new Date().toISOString().slice(0, 10);
  const dates = monthlySchedule(startOn, until);
  if (dates.length === 0) throw new HttpError(400, 'invalid_input', 'startOn is in the future');

  const client = await db().connect();
  try {
    await client.query('BEGIN');
    for (const on of dates) {
      await client.query(
        `INSERT INTO contributions (asset_id, amount_paise, contributed_on, note) VALUES ($1,$2,$3,$4)`,
        [assetId, rupeesToPaise(amount), on, 'SIP']
      );
    }
    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
  return { added: dates.length };
}

// ---- loans ----------------------------------------------------------------

const loanRow = (r: any) => ({
  id: r.id,
  householdId: r.household_id,
  name: r.name,
  outstanding: paiseToRupees(r.outstanding_paise),
  emiMonthly: paiseToRupees(r.emi_monthly_paise),
  ratePct: r.rate_pct != null ? Number(r.rate_pct) : null,
  securedAssetId: r.secured_asset_id ?? null,
  memberId: r.member_id ?? null,
});

export async function listLoans(householdId: string) {
  await getHousehold(householdId);
  const { rows } = await db().query(
    `SELECT * FROM loans WHERE household_id = $1 ORDER BY outstanding_paise DESC`, [householdId]);
  return rows.map(loanRow);
}

function ratePct(v: unknown): number | null {
  if (v == null || v === '') return null;
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0 || n > 100) throw new HttpError(400, 'invalid_input', 'ratePct must be between 0 and 100');
  return n;
}

export async function createLoan(householdId: string, body: any) {
  await getHousehold(householdId);
  const name = str(body.name, 'name', { required: true });
  const outstanding = money(body.outstanding, 'outstanding', { required: true })!;
  const emi = money(body.emiMonthly, 'emiMonthly', { required: true })!;
  const { rows } = await db().query(
    `INSERT INTO loans (household_id, name, outstanding_paise, emi_monthly_paise, rate_pct, secured_asset_id, member_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
    [householdId, name, rupeesToPaise(outstanding), rupeesToPaise(emi), ratePct(body.ratePct),
     str(body.securedAssetId, 'securedAssetId') ?? null, str(body.memberId, 'memberId') ?? null]
  );
  return loanRow(rows[0]);
}

export async function updateLoan(id: string, body: any) {
  const sets: string[] = [];
  const vals: any[] = [];
  const push = (col: string, val: any) => { vals.push(val); sets.push(`${col} = $${vals.length}`); };

  if ('name' in body) push('name', str(body.name, 'name', { required: true }));
  if ('outstanding' in body) push('outstanding_paise', rupeesToPaise(money(body.outstanding, 'outstanding', { required: true })!));
  if ('emiMonthly' in body) push('emi_monthly_paise', rupeesToPaise(money(body.emiMonthly, 'emiMonthly', { required: true })!));
  if ('ratePct' in body) push('rate_pct', ratePct(body.ratePct));
  if ('securedAssetId' in body) push('secured_asset_id', str(body.securedAssetId, 'securedAssetId') ?? null);
  if ('memberId' in body) push('member_id', str(body.memberId, 'memberId') ?? null);
  if (sets.length === 0) {
    const { rows } = await db().query(`SELECT * FROM loans WHERE id = $1`, [id]);
    if (rows.length === 0) throw new HttpError(404, 'loan_not_found');
    return loanRow(rows[0]);
  }
  vals.push(id);
  const { rows } = await db().query(`UPDATE loans SET ${sets.join(', ')} WHERE id = $${vals.length} RETURNING *`, vals);
  if (rows.length === 0) throw new HttpError(404, 'loan_not_found');
  return loanRow(rows[0]);
}

export async function deleteLoan(id: string) {
  const { rowCount } = await db().query(`DELETE FROM loans WHERE id = $1`, [id]);
  if (rowCount === 0) throw new HttpError(404, 'loan_not_found');
}
