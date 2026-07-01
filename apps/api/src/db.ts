import { assess, type Position, type Asset, type Loan, type AssetClass, type Assessment } from '@atlas/engine';
import { pool, paiseToRupees, HttpError } from './pool.ts';

interface Member { id: string; name: string; income?: number; essential?: number; }
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
      `SELECT id, name, asset_class, current_value_paise, liquid, cost_basis_paise, monthly_contribution_paise, member_id
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
    pool.query(`SELECT id, name, monthly_income_paise, monthly_essential_paise FROM members WHERE household_id = $1`, [householdId]),
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

  const members: Member[] = membersR.rows.map((r) => ({
    id: r.id,
    name: r.name,
    income: r.monthly_income_paise != null ? paiseToRupees(r.monthly_income_paise) : undefined,
    essential: r.monthly_essential_paise != null ? paiseToRupees(r.monthly_essential_paise) : undefined,
  }));

  // Household income aggregates from members when any member records income;
  // otherwise fall back to the household's own single figure.
  const hh = hhR.rows[0];
  const anyIncome = members.some((m) => m.income != null);
  const anyEssential = members.some((m) => m.essential != null);
  const hhIncome = anyIncome
    ? members.reduce((s, m) => s + (m.income ?? 0), 0)
    : hh.monthly_take_home_paise != null ? paiseToRupees(hh.monthly_take_home_paise) : undefined;
  const hhEssential = anyEssential
    ? members.reduce((s, m) => s + (m.essential ?? 0), 0)
    : hh.monthly_essential_paise != null ? paiseToRupees(hh.monthly_essential_paise) : undefined;

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

/** A per-member assessment: each member's own assets, loans and income run through the engine. */
export async function memberAssessments(
  householdId: string,
  asOf?: Date | string
): Promise<{ id: string; name: string; monthlyIncome: number | null; monthlyEssential: number | null; assessment: Assessment }[]> {
  const l = await load(householdId);
  return l.members.map((m) => {
    const assets = l.assets.filter((a) => l.assetMember.get(a.id) === m.id);
    const loans = l.loans.filter((ln) => l.loanMember.get(ln.id) === m.id);
    const pos = toPosition(assets, loans, m.income, m.essential);
    return {
      id: m.id,
      name: m.name,
      monthlyIncome: m.income ?? null,
      monthlyEssential: m.essential ?? null,
      assessment: assess(pos, asOf),
    };
  });
}
