import type { Position, Asset, Loan, AssetClass } from '@atlas/engine';
import { pool, paiseToRupees, HttpError } from './pool.ts';

/**
 * Load a household's position from Postgres and shape it for the engine.
 * The engine is storage-agnostic; this and repo.ts are the only places that know SQL.
 */
export async function loadPosition(householdId: string): Promise<Position> {
  if (!pool) throw new HttpError(503, 'no_database', 'DATABASE_URL not set');

  const [assetsR, loansR, hhR, contribR] = await Promise.all([
    pool.query(
      `SELECT id, name, asset_class, current_value_paise, liquid, cost_basis_paise, monthly_contribution_paise
         FROM assets WHERE household_id = $1`,
      [householdId]
    ),
    pool.query(
      `SELECT id, name, outstanding_paise, emi_monthly_paise, rate_pct, secured_asset_id
         FROM loans WHERE household_id = $1`,
      [householdId]
    ),
    pool.query(
      `SELECT monthly_take_home_paise, monthly_essential_paise FROM households WHERE id = $1`,
      [householdId]
    ),
    pool.query(
      `SELECT c.asset_id, c.amount_paise, c.contributed_on
         FROM contributions c JOIN assets a ON a.id = c.asset_id
        WHERE a.household_id = $1`,
      [householdId]
    ),
  ]);

  if (hhR.rowCount === 0) throw new HttpError(404, 'household_not_found');

  const contribByAsset = new Map<string, { amount: number; on: string }[]>();
  for (const r of contribR.rows) {
    const list = contribByAsset.get(r.asset_id) ?? [];
    list.push({ amount: paiseToRupees(r.amount_paise), on: r.contributed_on });
    contribByAsset.set(r.asset_id, list);
  }

  const assets: Asset[] = assetsR.rows.map((r) => ({
    id: r.id,
    name: r.name,
    assetClass: r.asset_class as AssetClass,
    value: paiseToRupees(r.current_value_paise),
    liquid: r.liquid,
    costBasis: r.cost_basis_paise != null ? paiseToRupees(r.cost_basis_paise) : undefined,
    monthlyContribution: r.monthly_contribution_paise != null ? paiseToRupees(r.monthly_contribution_paise) : undefined,
    contributions: contribByAsset.get(r.id),
  }));

  const loans: Loan[] = loansR.rows.map((r) => ({
    id: r.id,
    name: r.name,
    outstanding: paiseToRupees(r.outstanding_paise),
    emiMonthly: paiseToRupees(r.emi_monthly_paise),
    ratePct: r.rate_pct ? Number(r.rate_pct) : undefined,
    securedAgainstAssetId: r.secured_asset_id ?? undefined,
  }));

  const hh = hhR.rows[0];
  return {
    assets,
    loans,
    income: hh?.monthly_take_home_paise
      ? { monthlyTakeHome: paiseToRupees(hh.monthly_take_home_paise) }
      : undefined,
    expenses: hh?.monthly_essential_paise
      ? { monthlyEssential: paiseToRupees(hh.monthly_essential_paise) }
      : undefined,
  };
}
