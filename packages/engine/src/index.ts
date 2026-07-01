import type { Position, Assessment } from './types.ts';
import { netWorth } from './networth.ts';
import { exposure } from './exposure.ts';
import { signals } from './signals.ts';

export * from './types.ts';
export { netWorth } from './networth.ts';
export { exposure } from './exposure.ts';
export { signals } from './signals.ts';
export { formatINR } from './format.ts';

/** Run the full assessment: net worth, exposure and descriptive signals. */
export function assess(p: Position): Assessment {
  return { netWorth: netWorth(p), exposure: exposure(p), signals: signals(p) };
}

/** A representative salaried-professional position for demos and tests. */
export const salariedSample: Position = {
  assets: [
    { id: 'flat', name: 'Home (2BHK)', assetClass: 'real_estate', value: 8_500_000, liquid: false },
    { id: 'epf', name: 'EPF', assetClass: 'epf', value: 900_000, liquid: false },
    { id: 'ppf', name: 'PPF', assetClass: 'ppf', value: 400_000, liquid: false },
    { id: 'mf', name: 'Equity mutual funds', assetClass: 'mutual_fund', value: 500_000, liquid: true },
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
