import type { Position, IncomeBreakdown } from './types.ts';

const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

/**
 * Monthly income, split by source. Earned income (salary/take-home) is kept
 * distinct from what the assets throw off (rent, and similar), so strain against
 * salary and total cash-in can each be read honestly.
 */
export function income(p: Position): IncomeBreakdown {
  const earned = p.income?.monthlyTakeHome ?? 0;
  // Rent net of TDS — the cash that actually lands.
  const fromAssets = sum(p.assets.map((a) => Math.max(0, (a.monthlyRent ?? 0) - (a.rentTds ?? 0))));
  return { earned, fromAssets, total: earned + fromAssets };
}
