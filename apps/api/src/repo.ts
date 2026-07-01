import type { AssetClass } from '@atlas/engine';
import { db, rupeesToPaise, paiseToRupees, HttpError } from './pool.ts';

// ---- shared validation helpers -------------------------------------------

const ASSET_CLASSES: AssetClass[] = [
  'real_estate', 'mutual_fund', 'sip', 'equity', 'epf', 'ppf', 'cash', 'gold', 'insurance', 'other',
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

// ---- assets (with optional real-estate profile) ---------------------------

const assetRow = (r: any) => ({
  id: r.id,
  householdId: r.household_id,
  name: r.name,
  assetClass: r.asset_class,
  value: paiseToRupees(r.current_value_paise),
  liquid: r.liquid,
  parentAssetId: r.parent_asset_id ?? null,
  realEstate: r.address != null || r.ptin != null || r.sqft != null
    ? {
        address: r.address ?? null,
        sqft: r.sqft != null ? Number(r.sqft) : null,
        undividedShare: r.undivided_share ?? null,
        ptin: r.ptin ?? null,
        carPark: r.car_park ?? null,
        carParkSize: r.car_park_size ?? null,
      }
    : null,
});

const ASSET_SELECT = `
  SELECT a.*, p.address, p.sqft, p.undivided_share, p.ptin, p.car_park, p.car_park_size
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
    `INSERT INTO real_estate_profiles (asset_id, address, sqft, undivided_share, ptin, car_park, car_park_size)
     VALUES ($1,$2,$3,$4,$5,$6,$7)
     ON CONFLICT (asset_id) DO UPDATE SET
       address = EXCLUDED.address, sqft = EXCLUDED.sqft, undivided_share = EXCLUDED.undivided_share,
       ptin = EXCLUDED.ptin, car_park = EXCLUDED.car_park, car_park_size = EXCLUDED.car_park_size`,
    [assetId, str(re.address, 'address'), re.sqft != null && re.sqft !== '' ? Number(re.sqft) : null,
     str(re.undividedShare, 'undividedShare'), str(re.ptin, 'ptin'), str(re.carPark, 'carPark'), str(re.carParkSize, 'carParkSize')]
  );
}

export async function createAsset(householdId: string, body: any) {
  await getHousehold(householdId);
  const name = str(body.name, 'name', { required: true });
  const cls = assetClass(body.assetClass);
  const value = money(body.value, 'value', { required: true })!;
  const liquid = bool(body.liquid) ?? false;

  const client = await db().connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query(
      `INSERT INTO assets (household_id, name, asset_class, current_value_paise, liquid)
       VALUES ($1,$2,$3,$4,$5) RETURNING id`,
      [householdId, name, cls, rupeesToPaise(value), liquid]
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

// ---- loans ----------------------------------------------------------------

const loanRow = (r: any) => ({
  id: r.id,
  householdId: r.household_id,
  name: r.name,
  outstanding: paiseToRupees(r.outstanding_paise),
  emiMonthly: paiseToRupees(r.emi_monthly_paise),
  ratePct: r.rate_pct != null ? Number(r.rate_pct) : null,
  securedAssetId: r.secured_asset_id ?? null,
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
    `INSERT INTO loans (household_id, name, outstanding_paise, emi_monthly_paise, rate_pct, secured_asset_id)
     VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
    [householdId, name, rupeesToPaise(outstanding), rupeesToPaise(emi), ratePct(body.ratePct), str(body.securedAssetId, 'securedAssetId') ?? null]
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
