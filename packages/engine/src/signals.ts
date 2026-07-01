import type { Position, Signal, Severity } from './types.ts';
import { exposure } from './exposure.ts';

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
export function signals(p: Position): Signal[] {
  const ex = exposure(p);
  const out: Signal[] = [];

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

  if (ex.emiToIncome != null) {
    const v = ex.emiToIncome;
    out.push({
      key: 'emi',
      label: 'EMI vs income',
      value: v,
      display: `${v.toFixed(0)}%`,
      severity: band(v, 30, 40),
      message: `EMIs take ${v.toFixed(0)}% of your take-home pay.`,
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
