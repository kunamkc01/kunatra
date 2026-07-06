/**
 * Pulse — the operational heartbeat behind the property-first register and the
 * asset page's "This month" card. Read-only aggregates over tables that already
 * exist; nothing here writes.
 */
import { db, paiseToRupees } from './pool.ts';

const monthStart = (d: Date) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1)).toISOString().slice(0, 10);

/** One dot per month, oldest first: 'collected' | 'due' | 'waived' | 'none'. */
export interface RentDot { month: string; status: string }

export interface PropertyPulse {
  assetId: string;
  rentStatus: string | null;        // this month: collected | due | waived | null (not rented / no row yet)
  rentDots: RentDot[];              // last 6 months incl. current
  openRequests: number;             // open/in-progress work orders on this asset
  tenantRaised: boolean;            // any of those raised via the tenant portal
  docCount: number;
  photoDataUrl: string | null;      // earliest photo (the "cover")
  aiMid: number | null;             // current AI estimate (₹), when status = ok
}

/** Per-property operational state for every real-estate asset in a household — one round trip. */
export async function propertyPulse(householdId: string, opts: { financials: boolean }): Promise<PropertyPulse[]> {
  const now = new Date();
  const from = monthStart(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 5, 1)));
  const cur = monthStart(now);

  const { rows } = await db().query(
    `SELECT a.id,
            (SELECT json_agg(json_build_object('month', rc.period_month, 'status', rc.status) ORDER BY rc.period_month)
               FROM rent_collections rc
              WHERE rc.asset_id = a.id AND rc.period_month >= $2) AS rent,
            (SELECT count(*) FROM work_orders w
              WHERE w.asset_id = a.id AND w.status IN ('open','in_progress')) AS open_requests,
            (SELECT count(*) FROM work_orders w
              WHERE w.asset_id = a.id AND w.status IN ('open','in_progress') AND w.tenant_id IS NOT NULL) AS tenant_raised,
            (SELECT count(*) FROM documents d WHERE d.asset_id = a.id) AS doc_count,
            (SELECT p.data_url FROM asset_photos p WHERE p.asset_id = a.id ORDER BY p.created_at LIMIT 1) AS photo,
            (SELECT v.estimated_value_paise FROM property_valuations v
              WHERE v.asset_id = a.id AND v.status = 'ok') AS ai_mid_paise
       FROM assets a
      WHERE a.household_id = $1 AND a.asset_class = 'real_estate' AND a.parent_asset_id IS NULL`,
    [householdId, from],
  );

  return rows.map((r: any) => {
    const byMonth = new Map<string, string>((r.rent ?? []).map((x: any) => [String(x.month).slice(0, 10), x.status]));
    const dots: RentDot[] = [];
    for (let i = 5; i >= 0; i--) {
      const m = monthStart(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1)));
      dots.push({ month: m, status: byMonth.get(m) ?? 'none' });
    }
    return {
      assetId: r.id,
      rentStatus: byMonth.get(cur) ?? null,
      rentDots: dots,
      openRequests: Number(r.open_requests),
      tenantRaised: Number(r.tenant_raised) > 0,
      docCount: Number(r.doc_count),
      photoDataUrl: r.photo ?? null,
      aiMid: opts.financials && r.ai_mid_paise != null ? paiseToRupees(r.ai_mid_paise) : null,
    };
  });
}

export interface AssetActivity { at: string; kind: string; text: string }

export interface AssetPulse {
  rent: { id: string; status: string; collectedOn: string | null; amountDue: number } | null; // this month
  openWorkOrders: { id: string; title: string; status: string; tenantRaised: boolean }[];
  nextCompliance: { title: string; dueOn: string } | null;
  activity: AssetActivity[];
}

/** The asset page's "This month" card + recent-activity feed. */
export async function assetPulse(assetId: string): Promise<AssetPulse> {
  const cur = monthStart(new Date());
  const [rentQ, woQ, compQ, actQ] = await Promise.all([
    db().query(
      `SELECT id, status, collected_on, amount_due_paise FROM rent_collections
        WHERE asset_id = $1 AND period_month = $2`, [assetId, cur]),
    db().query(
      `SELECT id, title, status, tenant_id FROM work_orders
        WHERE asset_id = $1 AND status IN ('open','in_progress') ORDER BY created_at DESC LIMIT 5`, [assetId]),
    db().query(
      `SELECT title, due_on FROM compliance_items
        WHERE asset_id = $1 AND due_on >= CURRENT_DATE ORDER BY due_on LIMIT 1`, [assetId]),
    db().query(
      `SELECT at, kind, text FROM (
         SELECT d.uploaded_at AS at, 'document' AS kind, d.filename AS text
           FROM documents d WHERE d.asset_id = $1
         UNION ALL
         SELECT (rc.collected_on + time '12:00')::timestamptz, 'rent',
                to_char(rc.period_month, 'Mon YYYY') || ' rent collected'
           FROM rent_collections rc WHERE rc.asset_id = $1 AND rc.status = 'collected' AND rc.collected_on IS NOT NULL
         UNION ALL
         SELECT w.created_at, CASE WHEN w.tenant_id IS NOT NULL THEN 'tenant_request' ELSE 'work_order' END,
                w.title
           FROM work_orders w WHERE w.asset_id = $1
         UNION ALL
         SELECT vh.generated_at, 'ai_estimate',
                'AI estimate refreshed'
           FROM valuation_history vh WHERE vh.asset_id = $1
         UNION ALL
         SELECT (v.as_of + time '12:00')::timestamptz, 'valuation',
                'Valuation recorded' || CASE WHEN v.source IS NOT NULL THEN ' (' || v.source || ')' ELSE '' END
           FROM valuations v WHERE v.asset_id = $1
       ) ev ORDER BY at DESC LIMIT 10`, [assetId]),
  ]);

  const r = rentQ.rows[0];
  return {
    rent: r ? { id: r.id, status: r.status, collectedOn: r.collected_on ?? null, amountDue: paiseToRupees(r.amount_due_paise) } : null,
    openWorkOrders: woQ.rows.map((w: any) => ({ id: w.id, title: w.title, status: w.status, tenantRaised: w.tenant_id != null })),
    nextCompliance: compQ.rows[0] ? { title: compQ.rows[0].title, dueOn: compQ.rows[0].due_on } : null,
    activity: actQ.rows.map((a: any) => ({ at: a.at, kind: a.kind, text: a.text })),
  };
}
