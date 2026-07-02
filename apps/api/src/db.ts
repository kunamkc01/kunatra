import { assess, exposure, investments, type Position, type Asset, type Loan, type AssetClass, type Assessment } from '@atlas/engine';
import { pool, paiseToRupees, HttpError } from './pool.ts';

interface Member { id: string; name: string; net?: number; }
interface Loaded {
  assets: Asset[];
  loans: Loan[];
  assetMember: Map<string, string | null>;
  loanMember: Map<string, string | null>;
  members: Member[];
  hhIncome?: number;
  hhEssential?: number;
}

/**
 * Load everything the engine needs for a household. The engine is storage-agnostic;
 * this and repo.ts are the only places that know SQL.
 */
async function load(householdId: string): Promise<Loaded> {
  if (!pool) throw new HttpError(503, 'no_database', 'DATABASE_URL not set');

  const [assetsR, loansR, hhR, contribR, membersR] = await Promise.all([
    pool.query(
      `SELECT id, name, asset_class, current_value_paise, liquid, cost_basis_paise, monthly_contribution_paise, member_id, monthly_rent_paise, monthly_rent_tds_paise
         FROM assets WHERE household_id = $1`,
      [householdId]
    ),
    pool.query(
      `SELECT id, name, outstanding_paise, emi_monthly_paise, rate_pct, secured_asset_id, member_id
         FROM loans WHERE household_id = $1`,
      [householdId]
    ),
    pool.query(`SELECT monthly_take_home_paise, monthly_essential_paise FROM households WHERE id = $1`, [householdId]),
    pool.query(
      `SELECT c.asset_id, c.amount_paise, c.contributed_on
         FROM contributions c JOIN assets a ON a.id = c.asset_id WHERE a.household_id = $1`,
      [householdId]
    ),
    pool.query(`SELECT id, name, monthly_gross_paise, monthly_tds_paise FROM members WHERE household_id = $1`, [householdId]),
  ]);

  if (hhR.rowCount === 0) throw new HttpError(404, 'household_not_found');

  const contribByAsset = new Map<string, { amount: number; on: string }[]>();
  for (const r of contribR.rows) {
    const list = contribByAsset.get(r.asset_id) ?? [];
    list.push({ amount: paiseToRupees(r.amount_paise), on: r.contributed_on });
    contribByAsset.set(r.asset_id, list);
  }

  const assetMember = new Map<string, string | null>();
  const assets: Asset[] = assetsR.rows.map((r) => {
    assetMember.set(r.id, r.member_id ?? null);
    return {
      id: r.id,
      name: r.name,
      assetClass: r.asset_class as AssetClass,
      value: paiseToRupees(r.current_value_paise),
      liquid: r.liquid,
      costBasis: r.cost_basis_paise != null ? paiseToRupees(r.cost_basis_paise) : undefined,
      monthlyContribution: r.monthly_contribution_paise != null ? paiseToRupees(r.monthly_contribution_paise) : undefined,
      monthlyRent: r.monthly_rent_paise != null ? paiseToRupees(r.monthly_rent_paise) : undefined,
      rentTds: r.monthly_rent_tds_paise != null ? paiseToRupees(r.monthly_rent_tds_paise) : undefined,
      contributions: contribByAsset.get(r.id),
    };
  });

  const loanMember = new Map<string, string | null>();
  const loans: Loan[] = loansR.rows.map((r) => {
    loanMember.set(r.id, r.member_id ?? null);
    return {
      id: r.id,
      name: r.name,
      outstanding: paiseToRupees(r.outstanding_paise),
      emiMonthly: paiseToRupees(r.emi_monthly_paise),
      ratePct: r.rate_pct ? Number(r.rate_pct) : undefined,
      securedAgainstAssetId: r.secured_asset_id ?? undefined,
    };
  });

  const members: Member[] = membersR.rows.map((r) => {
    const gross = r.monthly_gross_paise != null ? paiseToRupees(r.monthly_gross_paise) : undefined;
    const tds = r.monthly_tds_paise != null ? paiseToRupees(r.monthly_tds_paise) : 0;
    return { id: r.id, name: r.name, net: gross != null ? gross - tds : undefined };
  });

  // Net salary aggregates from members when any records income; else the household's
  // own take-home. Essentials are always household-level (shared spend).
  const hh = hhR.rows[0];
  const anyIncome = members.some((m) => m.net != null);
  const hhIncome = anyIncome
    ? members.reduce((s, m) => s + (m.net ?? 0), 0)
    : hh.monthly_take_home_paise != null ? paiseToRupees(hh.monthly_take_home_paise) : undefined;
  const hhEssential = hh.monthly_essential_paise != null ? paiseToRupees(hh.monthly_essential_paise) : undefined;

  return { assets, loans, assetMember, loanMember, members, hhIncome, hhEssential };
}

function toPosition(assets: Asset[], loans: Loan[], income?: number, essential?: number): Position {
  return {
    assets,
    loans,
    income: income != null ? { monthlyTakeHome: income } : undefined,
    expenses: essential != null ? { monthlyEssential: essential } : undefined,
  };
}

/** The whole household's position, with income aggregated across members. */
export async function loadPosition(householdId: string): Promise<Position> {
  const l = await load(householdId);
  return toPosition(l.assets, l.loans, l.hhIncome, l.hhEssential);
}

/**
 * A single asset's own picture: engine-computed metrics for the asset (plus any
 * components nested under it) and the loans secured against it. Reuses the same
 * pure engine functions as the household assessment, so the numbers agree.
 */
export async function assetDetail(assetId: string, asOf?: Date | string) {
  if (!pool) throw new HttpError(503, 'no_database', 'DATABASE_URL not set');

  const meta = await pool.query(`SELECT household_id, acquired_year FROM assets WHERE id = $1`, [assetId]);
  if (meta.rowCount === 0) throw new HttpError(404, 'asset_not_found');
  const householdId = meta.rows[0].household_id;
  const acquiredYear = meta.rows[0].acquired_year ?? null;

  const l = await load(householdId);
  const asset = l.assets.find((x) => x.id === assetId);
  if (!asset) throw new HttpError(404, 'asset_not_found');

  // Components nested under this asset (e.g. solar/lift on a property).
  const childRows = await pool.query(
    `SELECT id, name, asset_class, current_value_paise FROM assets WHERE parent_asset_id = $1 ORDER BY name`, [assetId]);
  const childIds = new Set<string>(childRows.rows.map((r) => r.id));
  const children = l.assets.filter((x) => childIds.has(x.id));
  const childrenOut = childRows.rows.map((r) => ({
    id: r.id, name: r.name, assetClass: r.asset_class as AssetClass, value: paiseToRupees(r.current_value_paise),
  }));

  const securedLoans = l.loans.filter((ln) => ln.securedAgainstAssetId === assetId);
  const groupAssets = [asset, ...children];
  const pos = toPosition(groupAssets, securedLoans, l.hhIncome, undefined);
  const inv = investments(pos, asOf);
  const exp = exposure(pos);

  const currentValue = groupAssets.reduce((s, x) => s + x.value, 0);
  const securedOutstanding = securedLoans.reduce((s, x) => s + x.outstanding, 0);
  const cb = asset.costBasis ?? null;
  const nowYear = (asOf ? new Date(asOf) : new Date()).getFullYear();
  const years = acquiredYear ? Math.max(1, nowYear - acquiredYear) : null;
  const appreciationCagrPct =
    cb && cb > 0 && years && currentValue > 0 ? (Math.pow(currentValue / cb, 1 / years) - 1) * 100 : null;

  const ownerId = l.assetMember.get(assetId) ?? null;
  const ownerName = ownerId ? (l.members.find((m) => m.id === ownerId)?.name ?? null) : null;

  return {
    ownerName,
    metrics: {
      currentValue,
      costBasis: cb,
      unrealizedGain: inv.unrealizedGain,
      gainPct: inv.gainPct,
      xirrPct: inv.xirrPct,
      monthlyContribution: inv.monthlyContribution,
      netRentMonthly: exp.monthlyRent,
      dscr: exp.dscr,
      emiToIncomePct: exp.emiToIncome,
      securedOutstanding,
      equity: currentValue - securedOutstanding,
      ltvPct: currentValue > 0 && securedOutstanding > 0 ? (securedOutstanding / currentValue) * 100 : null,
      appreciationCagrPct,
      acquiredYear,
    },
    securedLoans: securedLoans.map((ln) => ({ id: ln.id, name: ln.name, outstanding: ln.outstanding, emiMonthly: ln.emiMonthly, ratePct: ln.ratePct ?? null })),
    children: childrenOut,
  };
}

/** A per-member assessment: each member's own assets, loans and income run through the engine. */
export async function memberAssessments(
  householdId: string,
  asOf?: Date | string
): Promise<{ id: string; name: string; monthlyIncome: number | null; assessment: Assessment }[]> {
  const l = await load(householdId);
  return l.members.map((m) => {
    const assets = l.assets.filter((a) => l.assetMember.get(a.id) === m.id);
    const loans = l.loans.filter((ln) => l.loanMember.get(ln.id) === m.id);
    // Member's own net salary; essentials stay household-level, so omit here.
    const pos = toPosition(assets, loans, m.net, undefined);
    return {
      id: m.id,
      name: m.name,
      monthlyIncome: m.net ?? null,
      assessment: assess(pos, asOf),
    };
  });
}
