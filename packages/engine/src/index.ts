import type { Position, Assessment } from './types.ts';
import { netWorth } from './networth.ts';
import { exposure } from './exposure.ts';
import { investments } from './investments.ts';
import { income } from './income.ts';
import { signals } from './signals.ts';

export * from './types.ts';
export { netWorth } from './networth.ts';
export { exposure } from './exposure.ts';
export { investments } from './investments.ts';
export { income } from './income.ts';
export { xirr } from './xirr.ts';
export { signals } from './signals.ts';
export { formatINR } from './format.ts';

/**
 * Run the full assessment: net worth, exposure, investments and descriptive signals.
 * `asOf` (today) anchors the terminal value for XIRR; pass it from the caller so the
 * engine stays pure. Omit it and XIRR is simply null.
 */
export function assess(p: Position, asOf?: Date | string): Assessment {
  return { netWorth: netWorth(p), exposure: exposure(p), investments: investments(p, asOf), income: income(p), signals: signals(p, asOf) };
}

/** A representative salaried-professional position for demos and tests. */
export const salariedSample: Position = {
  assets: [
    { id: 'flat', name: 'Home (2BHK)', assetClass: 'real_estate', value: 8_500_000, liquid: false },
    { id: 'epf', name: 'EPF', assetClass: 'epf', value: 900_000, liquid: false },
    { id: 'ppf', name: 'PPF', assetClass: 'ppf', value: 400_000, liquid: false },
    { id: 'mf', name: 'Equity mutual funds (SIP)', assetClass: 'mutual_fund', value: 500_000, liquid: true, costBasis: 400_000, monthlyContribution: 15_000, contributions: [{ amount: 400_000, on: '2024-01-01' }] },
    { id: 'cash', name: 'Savings', assetClass: 'cash', value: 400_000, liquid: true },
    { id: 'gold', name: 'Gold', assetClass: 'gold', value: 300_000, liquid: false },
    { id: 'lic', name: 'LIC policy', assetClass: 'insurance', value: 200_000, liquid: false },
  ],
  loans: [
    { id: 'home', name: 'Home loan', outstanding: 5_800_000, emiMonthly: 52_000, ratePct: 8.6, securedAgainstAssetId: 'flat' },
  ],
  income: { monthlyTakeHome: 140_000 },
  expenses: { monthlyEssential: 50_000 },
};
