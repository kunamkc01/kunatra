import type { Position, Investments } from './types.ts';

const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

/**
 * Appreciation and recurring-investing summary.
 * Gain compares current value against cost basis for assets that record one
 * (works for any class — a flat bought at X now worth Y, a SIP, gold, etc.).
 * Monthly contribution sums the recurring commitments (SIP/RD/PPF/EPF/NPS).
 */
export function investments(p: Position): Investments {
  const withBasis = p.assets.filter((a) => a.costBasis != null && a.costBasis > 0);
  const invested = sum(withBasis.map((a) => a.costBasis as number));
  const currentValue = sum(withBasis.map((a) => a.value));
  const unrealizedGain = currentValue - invested;
  const contributing = p.assets.filter((a) => a.monthlyContribution != null && a.monthlyContribution > 0);

  return {
    invested,
    currentValue,
    unrealizedGain,
    gainPct: invested > 0 ? (unrealizedGain / invested) * 100 : null,
    monthlyContribution: sum(contributing.map((a) => a.monthlyContribution as number)),
    contributingCount: contributing.length,
  };
}
