import type { Position, Signal, Severity } from './types.ts';
import { exposure } from './exposure.ts';
import { investments } from './investments.ts';
import { income } from './income.ts';
import { formatINR } from './format.ts';

/**
 * Band a metric into good / watch / warning.
 * higherIsWorse=true: below `good` is good, above `warn` is warning.
 * higherIsWorse=false: above `good` is good, below `warn` is warning (e.g. runway).
 */
function band(v: number, good: number, warn: number, higherIsWorse = true): Severity {
  if (higherIsWorse) return v < good ? 'good' : v < warn ? 'watch' : 'warning';
  return v > good ? 'good' : v > warn ? 'watch' : 'warning';
}

/**
 * Returns plain-language statements of fact about the user's own position.
 * These DESCRIBE; they never recommend an action. That distinction is what
 * keeps the product clear of regulated investment advice.
 */
export function signals(p: Position, asOf?: Date | string): Signal[] {
  const ex = exposure(p);
  const inv = investments(p, asOf);
  const inc = income(p);
  const out: Signal[] = [];

  // Monthly surplus — everything coming in (salary + rent) less EMIs, essentials
  // and recurring investments (SIPs), which are committed cash out each month.
  if (inc.total > 0) {
    const totalEmi = p.loans.reduce((s, l) => s + l.emiMonthly, 0);
    const essential = p.expenses?.monthlyEssential ?? 0;
    const sip = inv.monthlyContribution;
    const surplus = inc.total - totalEmi - essential - sip;
    const pct = (surplus / inc.total) * 100;
    const outgoings = sip > 0 ? 'EMIs, essentials and SIPs' : 'EMIs and essentials';
    out.push({
      key: 'surplus',
      label: 'Monthly surplus',
      value: surplus,
      display: formatINR(surplus),
      severity: surplus < 0 ? 'warning' : pct < 10 ? 'watch' : 'good',
      message: surplus >= 0
        ? `After ${outgoings} you keep ${formatINR(surplus)} a month.`
        : `Your ${outgoings} run ${formatINR(-surplus)} more than you bring in each month.`,
    });
  }

  if (inv.xirrPct != null) {
    const v = inv.xirrPct;
    out.push({
      key: 'xirr',
      label: 'Return (XIRR)',
      value: v,
      display: `${v >= 0 ? '+' : ''}${v.toFixed(1)}%`,
      severity: v >= 0 ? 'good' : 'watch',
      message: `Your investments have returned ${v.toFixed(1)}% a year, accounting for when you put money in.`,
    });
  }

  if (inv.gainPct != null) {
    const v = inv.gainPct;
    out.push({
      key: 'appreciation',
      label: 'Investment gain',
      value: v,
      display: `${v >= 0 ? '+' : ''}${v.toFixed(0)}%`,
      severity: v >= 0 ? 'good' : 'watch',
      message: `Your invested assets are worth ${Math.abs(v).toFixed(0)}% ${v >= 0 ? 'more' : 'less'} than you put in.`,
    });
  }

  if (inv.monthlyContribution > 0 && p.income?.monthlyTakeHome) {
    const v = (inv.monthlyContribution / p.income.monthlyTakeHome) * 100;
    out.push({
      key: 'savings_rate',
      label: 'Monthly investing',
      value: v,
      display: `${v.toFixed(0)}%`,
      severity: v >= 20 ? 'good' : v >= 10 ? 'watch' : 'warning',
      message: `You put ${v.toFixed(0)}% of your take-home into recurring investments each month.`,
    });
  }

  if (ex.realEstateLTV != null) {
    const v = ex.realEstateLTV;
    out.push({
      key: 'ltv',
      label: 'Real-estate LTV',
      value: v,
      display: `${v.toFixed(0)}%`,
      severity: band(v, 60, 80),
      message: `You've borrowed ${v.toFixed(0)}% of your property's value.`,
    });
  }

  if (ex.dscr != null && ex.monthlyRent > 0) {
    const v = ex.dscr;
    out.push({
      key: 'dscr',
      label: 'Rent vs EMI',
      value: v,
      display: `${v.toFixed(2)}×`,
      severity: band(v, 1.2, 1.0, false),
      message: `Your rent covers ${v.toFixed(2)}× of your EMIs.`,
    });
  }

  if (ex.emiToIncome != null) {
    const v = ex.emiToIncome;
    out.push({
      key: 'emi',
      label: 'EMI vs income',
      value: v,
      display: `${v.toFixed(0)}%`,
      severity: band(v, 30, 40),
      message: `EMIs take ${v.toFixed(0)}% of your total monthly income.`,
    });
  }

  if (ex.runwayMonths != null) {
    const v = ex.runwayMonths;
    out.push({
      key: 'runway',
      label: 'Emergency runway',
      value: v,
      display: `${v.toFixed(1)} mo`,
      severity: band(v, 6, 3, false),
      message: `Liquid savings cover ${v.toFixed(1)} months of EMIs and essential spending.`,
    });
  }

  if (ex.topConcentration) {
    const v = ex.topConcentration.pct;
    out.push({
      key: 'concentration',
      label: 'Largest asset',
      value: v,
      display: `${v.toFixed(0)}%`,
      severity: band(v, 40, 60),
      message: `${ex.topConcentration.name} is ${v.toFixed(0)}% of everything you own.`,
    });
  }

  {
    const v = ex.debtToAssets;
    out.push({
      key: 'debt_assets',
      label: 'Debt vs assets',
      value: v,
      display: `${v.toFixed(0)}%`,
      severity: band(v, 40, 60),
      message: `${v.toFixed(0)}% of your assets are funded by debt.`,
    });
  }

  return out;
}
