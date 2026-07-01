import type { Position, Exposure } from './types.ts';

const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

export function exposure(p: Position): Exposure {
  const realEstate = p.assets.filter((a) => a.assetClass === 'real_estate');
  const realEstateValue = sum(realEstate.map((a) => a.value));
  const reIds = new Set(realEstate.map((a) => a.id));
  const realEstateDebt = sum(
    p.loans
      .filter((l) => l.securedAgainstAssetId && reIds.has(l.securedAgainstAssetId))
      .map((l) => l.outstanding)
  );

  const grossAssets = sum(p.assets.map((a) => a.value));
  const totalDebt = sum(p.loans.map((l) => l.outstanding));
  const totalEmi = sum(p.loans.map((l) => l.emiMonthly));
  const liquid = sum(p.assets.filter((a) => a.liquid).map((a) => a.value));

  const income = p.income?.monthlyTakeHome ?? null;
  const essential = p.expenses?.monthlyEssential ?? 0;
  const monthlyOutflow = totalEmi + essential;

  const top = [...p.assets].sort((a, b) => b.value - a.value)[0];

  return {
    realEstateValue,
    realEstateDebt,
    realEstateLTV: realEstateValue ? (realEstateDebt / realEstateValue) * 100 : null,
    debtToAssets: grossAssets ? (totalDebt / grossAssets) * 100 : 0,
    emiToIncome: income ? (totalEmi / income) * 100 : null,
    runwayMonths: monthlyOutflow > 0 ? liquid / monthlyOutflow : null,
    topConcentration:
      top && grossAssets ? { name: top.name, pct: (top.value / grossAssets) * 100 } : null,
  };
}
