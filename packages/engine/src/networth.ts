import { PERCEIVED_CLASSES, type Position, type NetWorth, type AssetClass } from './types.ts';

const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

export function netWorth(p: Position): NetWorth {
  const grossAssets = sum(p.assets.map((a) => a.value));
  const totalDebt = sum(p.loans.map((l) => l.outstanding));
  const liquidAssets = sum(p.assets.filter((a) => a.liquid).map((a) => a.value));

  const byClass = new Map<AssetClass, number>();
  for (const a of p.assets) {
    byClass.set(a.assetClass, (byClass.get(a.assetClass) || 0) + a.value);
  }
  const allocation = [...byClass.entries()]
    .map(([assetClass, value]) => ({
      assetClass,
      value,
      pct: grossAssets ? (value / grossAssets) * 100 : 0,
    }))
    .sort((x, y) => y.value - x.value);

  // Perceived = valued by opinion (untested until a sale); firm = the rest, net of
  // ALL debt — debt is absolute, so it weighs against the absolute side.
  const perceivedAssets = sum(p.assets.filter((a) => PERCEIVED_CLASSES.includes(a.assetClass)).map((a) => a.value));

  return {
    grossAssets,
    totalDebt,
    netWorth: grossAssets - totalDebt,
    liquidAssets,
    illiquidAssets: grossAssets - liquidAssets,
    perceivedAssets,
    firmNetWorth: grossAssets - perceivedAssets - totalDebt,
    allocation,
  };
}
