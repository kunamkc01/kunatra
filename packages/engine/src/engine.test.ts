import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assess, netWorth, exposure, salariedSample, xirr } from './index.ts';

test('net worth = gross assets minus debt', () => {
  const nw = netWorth(salariedSample);
  assert.equal(nw.grossAssets, 11_200_000);
  assert.equal(nw.totalDebt, 5_800_000);
  assert.equal(nw.netWorth, 5_400_000);
  assert.equal(nw.liquidAssets, 900_000);
});

test('exposure metrics', () => {
  const ex = exposure(salariedSample);
  assert.ok(Math.abs((ex.realEstateLTV ?? 0) - 68.2) < 0.1);
  assert.ok(Math.abs(ex.debtToAssets - 51.8) < 0.1);
  assert.ok(Math.abs((ex.emiToIncome ?? 0) - 37.1) < 0.1);
  assert.ok(Math.abs((ex.runwayMonths ?? 0) - 8.8) < 0.1);
  assert.ok(ex.topConcentration && Math.abs(ex.topConcentration.pct - 75.9) < 0.1);
});

test('xirr solves a known one-year return', () => {
  // Invest 1000, worth 1100 exactly one year later → ~10%.
  const r = xirr([{ amount: -1000, on: '2025-01-01' }, { amount: 1100, on: '2026-01-01' }]);
  assert.ok(r != null && Math.abs(r - 10) < 0.1);
  // Needs both an inflow and an outflow.
  assert.equal(xirr([{ amount: -1000, on: '2025-01-01' }]), null);
});

test('assess computes portfolio XIRR when given an as-of date', () => {
  const a = assess(salariedSample, '2026-01-01'); // 400k in on 2024-01-01, worth 500k → ~2yr
  assert.ok(a.investments.xirrPct != null && a.investments.xirrPct > 0);
  assert.ok(assess(salariedSample).investments.xirrPct === null); // null without as-of
});

test('signals describe, with severities', () => {
  const { signals } = assess(salariedSample);
  const ltv = signals.find((s) => s.key === 'ltv');
  const conc = signals.find((s) => s.key === 'concentration');
  assert.equal(ltv?.severity, 'watch');
  assert.equal(conc?.severity, 'warning');
  // Signals state facts, they never tell the user what to do.
  for (const s of signals) {
    assert.doesNotMatch(s.message, /should|must|buy|sell|recommend/i);
  }
});
