// Net-worth history — a mirror with memory. The daily sweep upserts one row per
// household per MONTH: the current month's point stays live, past months freeze
// when the calendar rolls over. Pure engine math; no AI, no external calls.
import { assess } from '@atlas/engine';
import { db, rupeesToPaise, paiseToRupees } from './pool.ts';
import { loadPosition, memberAssessments } from './db.ts';

/** Snapshot one household's current position into this month's row. */
export async function snapshotHousehold(householdId: string): Promise<boolean> {
  const pos = await loadPosition(householdId);
  if (pos.assets.length === 0 && pos.loans.length === 0) return false; // nothing to remember yet

  const a = assess(pos, new Date());
  const byClass: Record<string, number> = {};
  for (const asset of pos.assets) {
    byClass[asset.assetClass] = (byClass[asset.assetClass] ?? 0) + rupeesToPaise(asset.value);
  }
  const byMember: Record<string, number> = {};
  for (const m of await memberAssessments(householdId, new Date())) {
    byMember[m.id] = rupeesToPaise(m.assessment.netWorth.netWorth);
  }

  await db().query(
    `INSERT INTO networth_snapshots
       (household_id, month, net_worth_paise, gross_assets_paise, total_debt_paise, liquid_paise, by_member, by_class)
     VALUES ($1, date_trunc('month', current_date)::date, $2, $3, $4, $5, $6, $7)
     ON CONFLICT (household_id, month) DO UPDATE SET
       net_worth_paise = EXCLUDED.net_worth_paise,
       gross_assets_paise = EXCLUDED.gross_assets_paise,
       total_debt_paise = EXCLUDED.total_debt_paise,
       liquid_paise = EXCLUDED.liquid_paise,
       by_member = EXCLUDED.by_member,
       by_class = EXCLUDED.by_class,
       updated_at = now()`,
    [householdId,
     rupeesToPaise(a.netWorth.netWorth), rupeesToPaise(a.netWorth.grossAssets),
     rupeesToPaise(a.netWorth.totalDebt), rupeesToPaise(a.netWorth.liquidAssets ?? 0),
     JSON.stringify(byMember), JSON.stringify(byClass)]
  );
  return true;
}

/** The daily sweep: snapshot every household that has anything recorded. */
export async function sweepSnapshots(): Promise<void> {
  if (!process.env.DATABASE_URL) return;
  try {
    const { rows } = await db().query(`SELECT id FROM households`);
    let n = 0;
    for (const r of rows) {
      try { if (await snapshotHousehold(r.id)) n++; }
      catch (e: any) { console.error(`[history] snapshot ${r.id} failed: ${e?.message}`); }
    }
    if (n) console.log(`[history] snapshotted ${n} household(s)`);
  } catch (e: any) {
    console.error(`[history] sweep failed: ${e?.message}`);
  }
}

const toRupeeMap = (j: any) => {
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(j ?? {})) out[k] = paiseToRupees(v as number);
  return out;
};

/** The household's monthly history, oldest first. */
export async function listHistory(householdId: string) {
  const { rows } = await db().query(
    `SELECT * FROM networth_snapshots WHERE household_id = $1 ORDER BY month`, [householdId]);
  return rows.map((r) => ({
    month: r.month, // 'YYYY-MM-01'
    netWorth: paiseToRupees(r.net_worth_paise),
    grossAssets: paiseToRupees(r.gross_assets_paise),
    totalDebt: paiseToRupees(r.total_debt_paise),
    liquid: paiseToRupees(r.liquid_paise),
    byMember: toRupeeMap(r.by_member),
    byClass: toRupeeMap(r.by_class),
  }));
}
