// XIRR — annualized money-weighted return over dated cash flows.
// Convention: amount < 0 is money out of pocket (invested); amount > 0 is money
// received (a withdrawal, or the terminal current value). Returns a percent, or
// null when it can't be computed (need both signs and ≥2 flows).

export interface CashFlow {
  /** Rupees. Negative = invested, positive = received. */
  amount: number;
  /** ISO date, 'YYYY-MM-DD'. */
  on: string;
}

const MS_PER_YEAR = 365.25 * 24 * 60 * 60 * 1000;

export function xirr(flows: CashFlow[]): number | null {
  if (flows.length < 2) return null;
  const hasPos = flows.some((f) => f.amount > 0);
  const hasNeg = flows.some((f) => f.amount < 0);
  if (!hasPos || !hasNeg) return null;

  const times = flows.map((f) => new Date(`${f.on}T00:00:00Z`).getTime());
  if (times.some((t) => Number.isNaN(t))) return null;
  const t0 = Math.min(...times);
  const years = times.map((t) => (t - t0) / MS_PER_YEAR);
  const amounts = flows.map((f) => f.amount);

  const npv = (r: number) => amounts.reduce((s, a, i) => s + a / Math.pow(1 + r, years[i]), 0);
  const dnpv = (r: number) => amounts.reduce((s, a, i) => s - (years[i] * a) / Math.pow(1 + r, years[i] + 1), 0);

  // Newton–Raphson from a sensible guess.
  let r = 0.1;
  for (let i = 0; i < 60; i++) {
    const f = npv(r);
    const d = dnpv(r);
    if (!Number.isFinite(f) || !Number.isFinite(d) || d === 0) break;
    const next = r - f / d;
    if (!Number.isFinite(next) || next <= -0.999999) break;
    if (Math.abs(next - r) < 1e-8) return round(next);
    r = next;
  }

  // Bisection fallback over a wide bracket.
  let lo = -0.999999;
  let hi = 100;
  let flo = npv(lo);
  let fhi = npv(hi);
  if (!Number.isFinite(flo) || !Number.isFinite(fhi) || flo * fhi > 0) return null;
  for (let i = 0; i < 200; i++) {
    const mid = (lo + hi) / 2;
    const fmid = npv(mid);
    if (Math.abs(fmid) < 1e-7 || (hi - lo) / 2 < 1e-9) return round(mid);
    if (flo * fmid < 0) { hi = mid; fhi = fmid; } else { lo = mid; flo = fmid; }
  }
  return round((lo + hi) / 2);
}

const round = (rate: number) => Math.round(rate * 100 * 100) / 100; // percent, 2dp
