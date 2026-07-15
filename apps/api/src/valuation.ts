// AI property-valuation MVP. An informational ESTIMATE that lives beside the
// user's own value — it never writes to the asset. Provider-abstracted (Bedrock
// Converse API; the model is one env var). Prompts carry property
// characteristics ONLY — never owner names, contacts or household financials.
import { BedrockRuntimeClient, ConverseCommand } from '@aws-sdk/client-bedrock-runtime';
import { db, rupeesToPaise, paiseToRupees, HttpError } from './pool.ts';

// v3 (2026-07-14): purchase price removed — the model anchored to stale prices
// (16.2% off vs 4.8% without, on apartment benchmarks).
// v4 (same day): the sweep showed v3 collapsing LARGE/unusual assets (a 10,500
// sqft building; a villa bought 2024 estimated BELOW its own purchase). A
// recent purchase IS current market data, so: include the price only when the
// purchase is ≤3 years old, labeled a recent transaction; omit older ones.
export const PROMPT_VERSION = 'v4';
const REGION = process.env.NOTIFY_REGION ?? process.env.AWS_REGION ?? 'us-east-1';
const MODEL_ID = process.env.BEDROCK_MODEL_ID ?? 'us.amazon.nova-pro-v1:0';
const REFRESH_DAYS = 90;          // scheduled refresh
const MIN_REFRESH_HOURS = 20;     // user/edit-triggered refresh at most ~once a day

const creds = process.env.NOTIFY_ACCESS_KEY_ID && process.env.NOTIFY_SECRET_ACCESS_KEY
  ? { accessKeyId: process.env.NOTIFY_ACCESS_KEY_ID, secretAccessKey: process.env.NOTIFY_SECRET_ACCESS_KEY }
  : undefined;
const bedrock = creds ? new BedrockRuntimeClient({ region: REGION, credentials: creds }) : null;

// ---- provider abstraction ---------------------------------------------------

/** Property characteristics only — the whole surface we expose to the AI. */
export interface ValuationInput {
  city: string | null; locality: string | null; address: string | null;
  propertyType: string | null; sqft: number | null;
  bedrooms: number | null; bathrooms: number | null; floor: number | null; builtYear: number | null;
  purchasePrice: number | null; purchaseYear: number | null; monthlyRent: number | null;
}

/** A provider returns the model's raw text for our prompt (we parse/validate). */
export type ValuationProvider = (input: ValuationInput, modelId: string) => Promise<string>;

export type PropertyCategory = 'residential' | 'commercial' | 'agricultural';
/** Commercial and farmland price on different math than homes — branch by type. */
export function categoryOf(propertyType: string | null): PropertyCategory {
  const t = (propertyType ?? '').toLowerCase();
  if (/office|commercial|retail|shop|showroom|warehouse|industrial/.test(t)) return 'commercial';
  if (/agricultur|farm ?land|farm$/.test(t)) return 'agricultural';
  return 'residential';
}

function buildPrompt(i: ValuationInput): string {
  const known = Object.entries({
    city: i.city, locality: i.locality, address: i.address, property_type: i.propertyType,
    built_up_area_sqft: i.sqft, bedrooms: i.bedrooms, bathrooms: i.bathrooms, floor: i.floor,
    built_year: i.builtYear,
    // A stale purchase price anchors the model to old market levels, so only a
    // RECENT purchase (≤3y — genuinely current market data) is shared.
    ...(i.purchasePrice != null && i.purchaseYear != null && i.purchaseYear >= new Date().getFullYear() - 3
      ? { [`recent_transaction_price_inr_(bought_${i.purchaseYear})`]: i.purchasePrice }
      : {}),
    current_monthly_rent_inr: i.monthlyRent,
  }).filter(([, v]) => v != null && v !== '');
  const today = new Date().toLocaleDateString('en-IN', { month: 'long', year: 'numeric' });
  const cat = categoryOf(i.propertyType);
  return [
    `You are an Indian ${cat === 'commercial' ? 'COMMERCIAL' : 'residential'} real-estate analyst with current market knowledge. Estimate what this property would actually SELL for today, in ${today}.`,
    'IMPORTANT: prices in Indian metros — especially Hyderabad, Bengaluru, Pune and NCR — have appreciated steeply in recent years.',
    'Your training data likely reflects older, lower price levels; adjust upward to realistic current transaction prices for the specific locality.',
    'Do not lowball. Reflect genuine uncertainty in the low–high range and the confidence field, not by deflating the midpoint.',
    ...(i.monthlyRent ? [cat === 'commercial'
      ? 'Sanity check: Indian metro COMMERCIAL gross yields typically run 6–9% (offices; retail up to ~10%) — the sale value must be consistent with the stated rent (value ≈ annual rent ÷ yield).'
      : 'Sanity check: Indian metro residential gross rental yields typically run 2–5% — the sale value must be consistent with the stated rent (value ≈ annual rent ÷ yield).'] : []),
    'All money in INR (rupees, plain integers).',
    '',
    'Property:',
    ...known.map(([k, v]) => `  ${k}: ${v}`),
    '',
    'Respond with STRICT JSON only (no markdown, no prose) in exactly this shape:',
    '{"estimatedValue":int,"lowValue":int,"highValue":int,"pricePerSqft":int,"estimatedMonthlyRent":int,',
    ' "rentalYieldPct":number,"annualGrowthPct":number,"confidence":"low"|"medium"|"high",',
    ' "summary":"one short sentence","reasons":["...", "..."]}',
  ].join('\n');
}

const bedrockProvider: ValuationProvider = async (input, modelId) => {
  if (!bedrock) throw new Error('bedrock_not_configured');
  const res = await bedrock.send(new ConverseCommand({
    modelId,
    messages: [{ role: 'user', content: [{ text: buildPrompt(input) }] }],
    inferenceConfig: { maxTokens: 900, temperature: 0.2 },
  }));
  const text = res.output?.message?.content?.map((c: any) => c.text ?? '').join('') ?? '';
  if (!text) throw new Error('empty_response');
  return text;
};

let provider: ValuationProvider = bedrockProvider;
/** Test seam — swap the model call for a fake. */
export function _setProviderForTests(p: ValuationProvider | null) { provider = p ?? bedrockProvider; }

// ---- parsing + sanity validation -------------------------------------------

interface Estimate {
  estimatedValue: number; lowValue: number; highValue: number;
  pricePerSqft: number | null; estimatedMonthlyRent: number | null;
  rentalYieldPct: number | null; annualGrowthPct: number | null;
  confidence: 'low' | 'medium' | 'high'; summary: string; reasons: string[];
}

/** Parse the model text and sanity-check it. Returns null when it can't be trusted. */
export function parseEstimate(text: string, sqft: number | null, monthlyRent?: number | null): Estimate | null {
  // tolerate accidental markdown fences
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) return null;
  let j: any;
  try { j = JSON.parse(m[0]); } catch { return null; }

  const num = (v: any) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
  const est = num(j.estimatedValue), low = num(j.lowValue), high = num(j.highValue);
  if (est == null || low == null || high == null) return null;
  if (est <= 0 || low <= 0 || high <= 0 || low > est || est > high) return null;

  let ppsf = num(j.pricePerSqft);
  // Coarse India-wide plausibility band for ₹/sqft; cross-check against value/area.
  if (ppsf != null && (ppsf < 500 || ppsf > 200000)) return null;
  if (sqft && sqft > 0) {
    const implied = est / sqft;
    if (implied < 300 || implied > 300000) return null;
    if (ppsf == null) ppsf = Math.round(implied);
  }

  const rent = num(j.estimatedMonthlyRent);
  if (rent != null && (rent < 0 || rent > est)) return null;
  // A value implying a gross yield beyond ~12.5% on the KNOWN rent is not a
  // believable Indian residential price (typical 2–5%) — the model has misread
  // the property. Better unavailable than absurd.
  if (monthlyRent && monthlyRent > 0 && est < monthlyRent * 12 * 8) return null;
  const yieldPct = num(j.rentalYieldPct);
  if (yieldPct != null && (yieldPct < 0 || yieldPct > 25)) return null;
  const growth = num(j.annualGrowthPct);
  if (growth != null && (growth < -15 || growth > 40)) return null;

  const confidence = ['low', 'medium', 'high'].includes(j.confidence) ? j.confidence : 'low';
  const summary = typeof j.summary === 'string' ? j.summary.slice(0, 500) : '';
  const reasons = Array.isArray(j.reasons) ? j.reasons.filter((r: any) => typeof r === 'string').slice(0, 6) : [];

  return { estimatedValue: est, lowValue: low, highValue: high, pricePerSqft: ppsf, estimatedMonthlyRent: rent, rentalYieldPct: yieldPct, annualGrowthPct: growth, confidence, summary, reasons };
}

// ---- income method (rental buildings) ----------------------------------------
// The LLM reliably fails on whole rental buildings (it outputs values its own
// yield claim contradicts), so they're valued deterministically from the rent:
// value = annual gross rent ÷ yield, at Hyderabad-typical residential yields of
// 2–4% (land under a prime-belt building pushes toward the low-yield/high-value
// end). Labeled as its own method; confidence low; the user's value stands.
export const INCOME_METHOD_VERSION = 'income-v1';
export function isIncomeBuilding(i: ValuationInput): boolean {
  if (!i.monthlyRent || i.monthlyRent <= 0) return false;
  // Rented commercial (an office floor, a showroom) is a pure income asset —
  // cap-rate math is the standard valuation and the model lowballs it anyway.
  if (categoryOf(i.propertyType) === 'commercial') return true;
  return !!(i.propertyType && /multi[- ]?unit|whole building|apartment building|independent building.*rented/i.test(i.propertyType));
}
export function incomeEstimate(monthlyRent: number, sqft: number | null, category: PropertyCategory = 'residential'): Estimate {
  const annual = monthlyRent * 12;
  // Yield bands: residential buildings trade at 2–4% gross; commercial at 6–9%.
  const [loY, midY, hiY] = category === 'commercial' ? [0.09, 0.075, 0.06] : [0.04, 0.03, 0.02];
  const low = Math.round(annual / loY);
  const mid = Math.round(annual / midY);
  const high = Math.round(annual / hiY);
  return {
    estimatedValue: mid, lowValue: low, highValue: high,
    pricePerSqft: sqft && sqft > 0 ? Math.round(mid / sqft) : null,
    estimatedMonthlyRent: monthlyRent, rentalYieldPct: midY * 100, annualGrowthPct: null,
    confidence: 'low',
    summary: `Income-based estimate from the rent you actually collect (₹${Math.round(annual).toLocaleString('en-IN')}/yr at ${Math.round(hiY * 100)}–${Math.round(loY * 100)}% gross yield, typical for Hyderabad ${category === 'commercial' ? 'commercial' : 'residential'} buildings).`,
    reasons: [
      'Whole rental buildings are valued from income, not per-unit comparisons.',
      category === 'commercial'
        ? 'Commercial assets trade at higher yields (6–9%) than homes — the same rent implies a lower price than a residential building.'
        : 'The land under a prime-locality building pushes value toward the top of the range.',
      'AI price models are unreliable for this asset class, so this is arithmetic, not an AI guess.',
    ],
  };
}

// ---- the worker --------------------------------------------------------------

async function loadInput(assetId: string): Promise<{ householdId: string; input: ValuationInput } | null> {
  const { rows } = await db().query(
    `SELECT a.household_id, a.asset_class, a.cost_basis_paise, a.acquired_year, a.monthly_rent_paise,
            p.address, p.sqft, p.property_type, p.bedrooms, p.bathrooms, p.floor, p.built_year, p.city, p.locality
       FROM assets a LEFT JOIN real_estate_profiles p ON p.asset_id = a.id
      WHERE a.id = $1`, [assetId]);
  const r = rows[0];
  if (!r || r.asset_class !== 'real_estate') return null;
  return {
    householdId: r.household_id,
    input: {
      city: r.city ?? null, locality: r.locality ?? null, address: r.address ?? null,
      propertyType: r.property_type ?? null, sqft: r.sqft != null ? Number(r.sqft) : null,
      bedrooms: r.bedrooms ?? null, bathrooms: r.bathrooms ?? null, floor: r.floor ?? null, builtYear: r.built_year ?? null,
      purchasePrice: r.cost_basis_paise != null ? paiseToRupees(r.cost_basis_paise) : null,
      purchaseYear: r.acquired_year ?? null,
      monthlyRent: r.monthly_rent_paise != null ? paiseToRupees(r.monthly_rent_paise) : null,
    },
  };
}

async function processValuation(assetId: string): Promise<void> {
  try {
    const loaded = await loadInput(assetId);
    if (!loaded) return;
    let est: Estimate | null = null;
    if (isIncomeBuilding(loaded.input)) {
      est = incomeEstimate(loaded.input.monthlyRent!, loaded.input.sqft, categoryOf(loaded.input.propertyType));
    } else {
      for (let attempt = 0; attempt < 2 && !est; attempt++) {   // retry once
        try { est = parseEstimate(await provider(loaded.input, MODEL_ID), loaded.input.sqft, loaded.input.monthlyRent); }
        catch (e: any) { console.error(`[valuation] ${assetId} attempt ${attempt + 1}: ${e?.name ?? e?.message}`); }
      }
    }
    if (!est) {
      await db().query(`UPDATE property_valuations SET status = 'unavailable', updated_at = now() WHERE asset_id = $1`, [assetId]);
      return;
    }
    await db().query(
      `UPDATE property_valuations SET
         status = 'ok', estimated_value_paise = $2, low_paise = $3, high_paise = $4,
         price_per_sqft_paise = $5, estimated_rent_paise = $6, rental_yield_pct = $7,
         annual_growth_pct = $8, confidence = $9, summary = $10, reasons = $11,
         provider = $12, prompt_version = $13, generated_at = now(), updated_at = now()
       WHERE asset_id = $1`,
      [assetId, rupeesToPaise(est.estimatedValue), rupeesToPaise(est.lowValue), rupeesToPaise(est.highValue),
       est.pricePerSqft != null ? rupeesToPaise(est.pricePerSqft) : null,
       est.estimatedMonthlyRent != null ? rupeesToPaise(est.estimatedMonthlyRent) : null,
       est.rentalYieldPct, est.annualGrowthPct, est.confidence, est.summary, JSON.stringify(est.reasons),
       isIncomeBuilding(loaded.input) ? 'income_method' : MODEL_ID,
       isIncomeBuilding(loaded.input) ? INCOME_METHOD_VERSION : PROMPT_VERSION]
    );
    // Every estimate is also a dated point — over refreshes this is the trendline.
    await db().query(
      `INSERT INTO valuation_history (asset_id, household_id, generated_at, estimated_value_paise, low_paise, high_paise, estimated_rent_paise, confidence, provider, prompt_version)
       VALUES ($1, $2, now(), $3, $4, $5, $6, $7, $8, $9)`,
      [assetId, loaded.householdId, rupeesToPaise(est.estimatedValue), rupeesToPaise(est.lowValue), rupeesToPaise(est.highValue),
       est.estimatedMonthlyRent != null ? rupeesToPaise(est.estimatedMonthlyRent) : null,
       est.confidence, isIncomeBuilding(loaded.input) ? 'income_method' : MODEL_ID,
       isIncomeBuilding(loaded.input) ? INCOME_METHOD_VERSION : PROMPT_VERSION]
    );
  } catch (e: any) {
    console.error(`[valuation] ${assetId} failed: ${e?.message}`);
    await db().query(`UPDATE property_valuations SET status = 'unavailable', updated_at = now() WHERE asset_id = $1`, [assetId]).catch(() => {});
  }
}

/** A property has a location the model can anchor on — a city, a locality, or a full address. */
export function hasResolvableLocation(i: ValuationInput): boolean {
  const s = (v: string | null) => typeof v === 'string' && v.trim() !== '';
  return s(i.city) || s(i.locality) || s(i.address);
}

/** Queue an estimate for a property (no-op for non-real-estate). Fire-and-forget. */
export async function requestValuation(assetId: string): Promise<boolean> {
  const loaded = await loadInput(assetId);
  if (!loaded) return false;
  // Without a location we'd only be guessing — and the model defaults to a metro
  // (Hyderabad). The property name is never sent (it carries the family name), so
  // it can't supply a location either. Mark unavailable instead of fabricating.
  if (categoryOf(loaded.input.propertyType) === 'agricultural') {
    await db().query(
      `INSERT INTO property_valuations (asset_id, household_id, status, summary, generated_at, updated_at)
       VALUES ($1, $2, 'unavailable', $3, NULL, now())
       ON CONFLICT (asset_id) DO UPDATE SET status = 'unavailable', summary = $3, generated_at = NULL, updated_at = now()`,
      [assetId, loaded.householdId, 'Agricultural land isn’t estimated yet — farm values turn on per-acre transactions, irrigation and road frontage. Enter your own value; it stays authoritative.']
    );
    return true;
  }
  if (!hasResolvableLocation(loaded.input)) {
    await db().query(
      `INSERT INTO property_valuations (asset_id, household_id, status, summary, generated_at, updated_at)
       VALUES ($1, $2, 'unavailable', $3, NULL, now())
       ON CONFLICT (asset_id) DO UPDATE SET status = 'unavailable', summary = $3, generated_at = NULL, updated_at = now()`,
      [assetId, loaded.householdId, 'Add the city or locality (or a full address) to get an estimate — Kunatra won’t guess a location.']
    );
    return true;
  }
  await db().query(
    `INSERT INTO property_valuations (asset_id, household_id, status)
     VALUES ($1, $2, 'pending')
     ON CONFLICT (asset_id) DO UPDATE SET status = 'pending', updated_at = now()`,
    [assetId, loaded.householdId]
  );
  void processValuation(assetId);
  return true;
}

/** Re-request only if the current estimate is stale enough (edit-triggered). */
export async function requestIfStale(assetId: string): Promise<void> {
  const { rows } = await db().query(
    `SELECT status, generated_at FROM property_valuations WHERE asset_id = $1`, [assetId]);
  const r = rows[0];
  if (r && r.status === 'pending') return;
  if (r && r.generated_at && Date.now() - new Date(r.generated_at).getTime() < MIN_REFRESH_HOURS * 3600_000) return;
  await requestValuation(assetId);
}

/**
 * The location or size — the estimate's core inputs — changed, so force a fresh
 * estimate now, bypassing the daily rate limit. (A stray double-click can't spam
 * this because the value has to actually change to get here.)
 */
export async function requestOnLocationChange(assetId: string): Promise<void> {
  const { rows } = await db().query(`SELECT status FROM property_valuations WHERE asset_id = $1`, [assetId]);
  if (rows[0]?.status === 'pending') return; // one already running
  await requestValuation(assetId);
}

const valuationRow = (r: any) => ({
  assetId: r.asset_id,
  status: r.status,
  estimatedValue: r.estimated_value_paise != null ? paiseToRupees(r.estimated_value_paise) : null,
  lowValue: r.low_paise != null ? paiseToRupees(r.low_paise) : null,
  highValue: r.high_paise != null ? paiseToRupees(r.high_paise) : null,
  pricePerSqft: r.price_per_sqft_paise != null ? paiseToRupees(r.price_per_sqft_paise) : null,
  estimatedRent: r.estimated_rent_paise != null ? paiseToRupees(r.estimated_rent_paise) : null,
  rentalYieldPct: r.rental_yield_pct != null ? Number(r.rental_yield_pct) : null,
  annualGrowthPct: r.annual_growth_pct != null ? Number(r.annual_growth_pct) : null,
  confidence: r.confidence ?? null,
  summary: r.summary ?? null,
  reasons: r.reasons ?? [],
  provider: r.provider ?? null,
  feedback: r.feedback ?? null,
  userValue: r.user_value_paise != null ? paiseToRupees(r.user_value_paise) : null,
  generatedAt: r.generated_at ?? null,
});

export async function getValuation(assetId: string) {
  const { rows } = await db().query(`SELECT * FROM property_valuations WHERE asset_id = $1`, [assetId]);
  if (!rows[0]) return null;
  const out: any = valuationRow(rows[0]);
  const h = await db().query(
    `SELECT generated_at, estimated_value_paise, low_paise, high_paise FROM valuation_history
      WHERE asset_id = $1 ORDER BY generated_at LIMIT 48`, [assetId]);
  out.history = h.rows.map((r) => ({
    at: r.generated_at,
    estimatedValue: paiseToRupees(r.estimated_value_paise),
    lowValue: r.low_paise != null ? paiseToRupees(r.low_paise) : null,
    highValue: r.high_paise != null ? paiseToRupees(r.high_paise) : null,
  }));
  return out;
}

/** User-requested refresh — at most ~once a day per property. */
export async function refreshValuation(assetId: string) {
  const { rows } = await db().query(`SELECT status, generated_at FROM property_valuations WHERE asset_id = $1`, [assetId]);
  const r = rows[0];
  if (r?.status === 'pending') return getValuation(assetId); // already running
  if (r?.generated_at && Date.now() - new Date(r.generated_at).getTime() < MIN_REFRESH_HOURS * 3600_000) {
    throw new HttpError(429, 'too_soon', 'This estimate was refreshed recently — try again tomorrow');
  }
  const ok = await requestValuation(assetId);
  if (!ok) throw new HttpError(400, 'not_a_property', 'Estimates are only available for real-estate assets');
  return getValuation(assetId);
}

export async function saveFeedback(assetId: string, body: any) {
  const fb = ['too_low', 'accurate', 'too_high'].includes(body.feedback) ? body.feedback : null;
  if (!fb) throw new HttpError(400, 'invalid_input', 'feedback must be too_low | accurate | too_high');
  const userValue = body.userValue != null && body.userValue !== '' ? Number(body.userValue) : null;
  if (userValue != null && (!Number.isFinite(userValue) || userValue <= 0)) {
    throw new HttpError(400, 'invalid_input', 'userValue must be a positive number');
  }
  const { rows } = await db().query(
    `UPDATE property_valuations SET feedback = $2, user_value_paise = $3, updated_at = now()
      WHERE asset_id = $1 RETURNING *`,
    [assetId, fb, userValue != null ? rupeesToPaise(userValue) : null]
  );
  if (rows.length === 0) throw new HttpError(404, 'valuation_not_found');
  return valuationRow(rows[0]);
}

/**
 * Daily sweep: refresh estimates older than 90 days, and rescue 'pending' rows
 * stuck for over an hour (e.g. the process restarted mid-call).
 */
export async function sweepValuations(): Promise<void> {
  if (!process.env.DATABASE_URL) return;
  try {
    const { rows } = await db().query(
      `SELECT asset_id FROM property_valuations
        WHERE (status = 'ok' AND generated_at < now() - interval '${REFRESH_DAYS} days')
           OR (status = 'pending' AND updated_at < now() - interval '1 hour')
        LIMIT 25`);
    for (const r of rows) await requestValuation(r.asset_id);
    if (rows.length) console.log(`[valuation] refreshed ${rows.length} stale estimate(s)`);
  } catch (e: any) {
    console.error(`[valuation] sweep failed: ${e?.message}`);
  }
}
