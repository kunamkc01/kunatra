import type { Position, Investments } from './types.ts';
import { xirr, type CashFlow } from './xirr.ts';

const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
const toISO = (d: Date | string) => (typeof d === 'string' ? d : d.toISOString().slice(0, 10));

/**
 * Appreciation and recurring-investing summary.
 * Gain compares current value against cost basis for assets that record one.
 * XIRR is the annualized money-weighted return across dated contributions —
 * each contribution is money out (negative), the current value is the terminal
 * inflow at `asOf` (today, supplied by the caller so the engine stays pure).
 */
export function investments(p: Position, asOf?: Date | string): Investments {
  const withBasis = p.assets.filter((a) => a.costBasis != null && a.costBasis > 0);
  const invested = sum(withBasis.map((a) => a.costBasis as number));
  const currentValue = sum(withBasis.map((a) => a.value));
  const unrealizedGain = currentValue - invested;
  const contributing = p.assets.filter((a) => a.monthlyContribution != null && a.monthlyContribution > 0);

  // XIRR over the dated contribution ledger, if any + an as-of date to anchor the terminal value.
  let xirrPct: number | null = null;
  if (asOf) {
    const flows: CashFlow[] = [];
    let terminal = 0;
    for (const a of p.assets) {
      if (a.contributions && a.contributions.length > 0) {
        for (const c of a.contributions) flows.push({ amount: -c.amount, on: c.on });
        terminal += a.value;
      }
    }
    if (flows.length > 0) {
      flows.push({ amount: terminal, on: toISO(asOf) });
      xirrPct = xirr(flows);
    }
  }

  return {
    invested,
    currentValue,
    unrealizedGain,
    gainPct: invested > 0 ? (unrealizedGain / invested) * 100 : null,
    monthlyContribution: sum(contributing.map((a) => a.monthlyContribution as number)),
    contributingCount: contributing.length,
    xirrPct,
  };
}
