/**
 * Mutual-fund / SIP valuation from AMFI NAVs. A fund-linked asset's value is
 * computed as units × latest NAV, where units come from the dated contributions
 * (each installment buys at that day's NAV). Only the public scheme code ever
 * leaves us — never amounts or identity.
 *
 * Data: api.mfapi.in (free wrapper over AMFI). Full history per scheme is cached
 * in-process (NAVs are immutable once published; refreshed every 12h).
 */
import { db, paiseToRupees, rupeesToPaise, HttpError } from './pool.ts';

export interface NavPoint { date: string; nav: number } // date = ISO yyyy-mm-dd
export interface Scheme { schemeCode: number; schemeName: string }

// ---- provider seam (faked in tests — no network) ----------------------------
type HistoryProvider = (schemeCode: string) => Promise<NavPoint[]>;   // ascending by date
type SearchProvider = (query: string) => Promise<Scheme[]>;
let _history: HistoryProvider | null = null;
let _search: SearchProvider | null = null;
export function _setFundProvidersForTests(history: HistoryProvider | null, search?: SearchProvider | null) {
  _history = history; _search = search ?? null;
}

const toIso = (ddmmyyyy: string) => { const [d, m, y] = ddmmyyyy.split('-'); return `${y}-${m}-${d}`; };

const liveHistory: HistoryProvider = async (schemeCode) => {
  const res = await fetch(`https://api.mfapi.in/mf/${schemeCode}`);
  if (!res.ok) throw new Error(`mfapi ${res.status}`);
  const j: any = await res.json();
  if (!Array.isArray(j?.data)) throw new Error('no nav data');
  return j.data
    .map((r: any) => ({ date: toIso(r.date), nav: Number(r.nav) }))
    .filter((p: NavPoint) => Number.isFinite(p.nav) && p.nav > 0)
    .sort((a: NavPoint, b: NavPoint) => a.date.localeCompare(b.date));   // ascending
};

const liveSearch: SearchProvider = async (query) => {
  const res = await fetchWithTimeout(`https://api.mfapi.in/mf/search?q=${encodeURIComponent(query)}`, 8000);
  if (!res.ok) throw new Error(`mfapi search ${res.status}`);
  const j: any = await res.json();
  return (Array.isArray(j) ? j : []).slice(0, 25).map((r: any) => ({ schemeCode: r.schemeCode, schemeName: r.schemeName }));
};

function fetchWithTimeout(url: string, ms: number): Promise<Response> {
  return fetch(url, { signal: AbortSignal.timeout(ms) });
}

// ---- scheme directory (search) ----------------------------------------------
// The remote search endpoint is a free community API and flakes under load, so
// search runs against the OFFICIAL AMFI directory instead: fetched once, held in
// memory, refreshed daily. Format: code;isin;isin;name;nav;date (headers lack ';').
const AMFI_URL = 'https://portal.amfiindia.com/spages/NAVAll.txt';
const DIRECTORY_TTL_MS = 24 * 3600_000;
let directory: Scheme[] = [];
let directoryAt = 0;

/** Parse AMFI's NAVAll.txt into schemes (pure — tested directly). */
export function parseAmfiDirectory(text: string): Scheme[] {
  const out: Scheme[] = [];
  for (const line of text.split('\n')) {
    const parts = line.split(';');
    if (parts.length < 5) continue;                    // section/AMC headers
    const code = Number(parts[0]);
    const name = (parts[3] ?? '').trim();
    if (Number.isFinite(code) && code > 0 && name) out.push({ schemeCode: code, schemeName: name });
  }
  return out;
}

// Fund houses and AMFI disagree on plan naming: ICICI lists its growth plans as
// "Cumulative Option", and older sheets say "Dividend" where apps say "IDCW".
const TOKEN_ALIASES: Record<string, string[]> = {
  growth: ['cumulative'], cumulative: ['growth'],
  idcw: ['dividend'], dividend: ['idcw'],
};

/** Rank matches: every token (or an alias) must appear; earlier and tighter matches first. */
export function searchDirectory(list: Scheme[], query: string, limit = 25): Scheme[] {
  const tokens = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (!tokens.length) return [];
  const scored: { s: Scheme; score: number }[] = [];
  for (const s of list) {
    const name = s.schemeName.toLowerCase();
    let score = 0;
    let ok = true;
    for (const t of tokens) {
      let i = name.indexOf(t);
      if (i === -1) for (const alias of TOKEN_ALIASES[t] ?? []) { i = name.indexOf(alias); if (i !== -1) break; }
      if (i === -1) { ok = false; break; }
      score += i;
    }
    if (ok) scored.push({ s, score: score + name.length / 10 });
  }
  return scored.sort((a, b) => a.score - b.score).slice(0, limit).map((x) => x.s);
}

export async function ensureDirectory(): Promise<Scheme[]> {
  if (directory.length && Date.now() - directoryAt < DIRECTORY_TTL_MS) return directory;
  try {
    const res = await fetchWithTimeout(AMFI_URL, 15000);
    if (!res.ok) throw new Error(`amfi ${res.status}`);
    const parsed = parseAmfiDirectory(await res.text());
    if (parsed.length > 1000) { directory = parsed; directoryAt = Date.now(); }
  } catch (e: any) {
    console.error(`[funds] AMFI directory refresh failed: ${e?.message}`);
  }
  return directory;
}

// ---- cache ------------------------------------------------------------------
const CACHE_TTL_MS = 12 * 3600_000;
const cache = new Map<string, { at: number; hist: NavPoint[] }>();

async function history(schemeCode: string): Promise<NavPoint[]> {
  const hit = cache.get(schemeCode);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.hist;
  const hist = await (_history ?? liveHistory)(schemeCode);
  cache.set(schemeCode, { at: Date.now(), hist });
  return hist;
}

/** NAV on the given date, else the nearest earlier trading day (holiday/weekend). */
export function navOnOrBefore(hist: NavPoint[], isoDate: string): number | null {
  let lo = 0, hi = hist.length - 1, ans: number | null = null;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (hist[mid].date <= isoDate) { ans = hist[mid].nav; lo = mid + 1; } else hi = mid - 1;
  }
  return ans ?? (hist[0]?.nav ?? null); // before the fund existed → earliest available
}

export interface FundValuation {
  schemeCode: string; schemeName: string | null;
  units: number; invested: number; currentValue: number;
  latestNav: number; latestNavDate: string; valuedAt: string | null;
}

/** Units × latest NAV from an asset's dated contributions. */
export async function computeValuation(assetId: string, schemeCode: string, schemeName: string | null): Promise<FundValuation | null> {
  const hist = await history(schemeCode);
  if (!hist.length) return null;
  const latest = hist[hist.length - 1];

  const { rows } = await db().query(
    `SELECT amount_paise, contributed_on FROM contributions WHERE asset_id = $1 ORDER BY contributed_on ASC`, [assetId]);
  let contribs = rows.map((r: any) => ({ amount: paiseToRupees(r.amount_paise), on: String(r.contributed_on).slice(0, 10) }));
  // Fall back to cost basis + acquired year if no contribution ledger yet.
  if (contribs.length === 0) {
    const a = await db().query(`SELECT cost_basis_paise, acquired_year FROM assets WHERE id = $1`, [assetId]);
    const cb = a.rows[0]?.cost_basis_paise, yr = a.rows[0]?.acquired_year;
    if (cb != null && yr) contribs = [{ amount: paiseToRupees(cb), on: `${yr}-01-01` }];
  }
  if (contribs.length === 0) return null; // nothing to value units from

  let units = 0, invested = 0;
  for (const c of contribs) {
    const nav = navOnOrBefore(hist, c.on);
    if (!nav) continue;
    units += c.amount / nav;      // withdrawals (amount<0) remove units
    invested += c.amount;
  }
  return {
    schemeCode, schemeName,
    units: Math.round(units * 1000) / 1000,
    invested: Math.round(invested),
    currentValue: Math.round(units * latest.nav),
    latestNav: latest.nav, latestNavDate: latest.date, valuedAt: null,
  };
}

export async function searchSchemes(query: string): Promise<Scheme[]> {
  if (!query || query.trim().length < 3) return [];
  if (_search) return _search(query.trim());            // test seam
  const dir = await ensureDirectory();
  if (dir.length) return searchDirectory(dir, query.trim());
  return liveSearch(query.trim());                      // directory unavailable → best effort
}

/** Link a scheme to an asset, compute its value and set it. Auto-valued from here on. */
export async function setFund(assetId: string, body: any): Promise<FundValuation> {
  const schemeCode = String(body.schemeCode ?? '').trim();
  if (!schemeCode) throw new HttpError(400, 'invalid_input', 'schemeCode is required');
  const schemeName = typeof body.schemeName === 'string' ? body.schemeName.trim() : null;

  const asset = await db().query(`SELECT asset_class FROM assets WHERE id = $1`, [assetId]);
  if (!asset.rows[0]) throw new HttpError(404, 'asset_not_found');
  if (!['mutual_fund', 'sip'].includes(asset.rows[0].asset_class)) {
    throw new HttpError(400, 'not_a_fund', 'NAV valuation is only for mutual funds and SIPs');
  }

  const val = await computeValuation(assetId, schemeCode, schemeName);
  await db().query(
    `UPDATE assets SET fund_scheme_code = $2, fund_scheme_name = $3,
        current_value_paise = COALESCE($4, current_value_paise),
        cost_basis_paise = COALESCE($5, cost_basis_paise), fund_valued_at = now()
      WHERE id = $1`,
    [assetId, schemeCode, schemeName,
     val ? rupeesToPaise(val.currentValue) : null,
     val ? rupeesToPaise(val.invested) : null]);
  if (!val) throw new HttpError(422, 'no_investment_dates', 'Add your investment date(s) so we can compute units, then link the fund.');
  return { ...val, valuedAt: new Date().toISOString() };
}

export async function getFund(assetId: string): Promise<FundValuation | null> {
  const { rows } = await db().query(`SELECT fund_scheme_code, fund_scheme_name, fund_valued_at FROM assets WHERE id = $1`, [assetId]);
  const r = rows[0];
  if (!r?.fund_scheme_code) return null;
  const val = await computeValuation(assetId, r.fund_scheme_code, r.fund_scheme_name).catch(() => null);
  if (!val) return { schemeCode: r.fund_scheme_code, schemeName: r.fund_scheme_name, units: 0, invested: 0, currentValue: 0, latestNav: 0, latestNavDate: '', valuedAt: r.fund_valued_at ?? null };
  return { ...val, valuedAt: r.fund_valued_at ?? null };
}

export async function unlinkFund(assetId: string): Promise<void> {
  await db().query(`UPDATE assets SET fund_scheme_code = NULL, fund_scheme_name = NULL, fund_valued_at = NULL WHERE id = $1`, [assetId]);
}

/** Recompute one asset's value from the latest NAV and save it. */
export async function refreshFundValue(assetId: string): Promise<void> {
  const { rows } = await db().query(`SELECT fund_scheme_code, fund_scheme_name FROM assets WHERE id = $1`, [assetId]);
  const r = rows[0];
  if (!r?.fund_scheme_code) return;
  const val = await computeValuation(assetId, r.fund_scheme_code, r.fund_scheme_name).catch(() => null);
  if (val) await db().query(
    `UPDATE assets SET current_value_paise = $2, cost_basis_paise = $3, fund_valued_at = now() WHERE id = $1`,
    [assetId, rupeesToPaise(val.currentValue), rupeesToPaise(val.invested)]);
}

/** Daily: refresh every fund-linked asset's value from the latest NAV. */
export async function sweepFundValues(): Promise<void> {
  const { rows } = await db().query(`SELECT id FROM assets WHERE fund_scheme_code IS NOT NULL`);
  for (const r of rows) await refreshFundValue(r.id).catch(() => {});
}
