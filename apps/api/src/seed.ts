/**
 * Seed a demo household from the engine's salaried sample.
 * Run: DATABASE_URL=... node --experimental-strip-types src/seed.ts
 * Prints the new household id (use it as ?household=<id>).
 */
import { salariedSample } from '@atlas/engine';
import { db, rupeesToPaise } from './pool.ts';

async function main() {
  const client = await db().connect();
  try {
    await client.query('BEGIN');
    const hh = await client.query(
      `INSERT INTO households (display_name, monthly_take_home_paise, monthly_essential_paise)
       VALUES ($1,$2,$3) RETURNING id`,
      [
        'Demo — salaried professional',
        rupeesToPaise(salariedSample.income!.monthlyTakeHome),
        rupeesToPaise(salariedSample.expenses!.monthlyEssential),
      ]
    );
    const householdId = hh.rows[0].id;

    // Map the sample's string ids to the generated asset UUIDs so loans can link.
    const idMap = new Map<string, string>();
    for (const a of salariedSample.assets) {
      const r = await client.query(
        `INSERT INTO assets (household_id, name, asset_class, current_value_paise, liquid)
         VALUES ($1,$2,$3,$4,$5) RETURNING id`,
        [householdId, a.name, a.assetClass, rupeesToPaise(a.value), a.liquid]
      );
      idMap.set(a.id, r.rows[0].id);
    }
    for (const l of salariedSample.loans) {
      await client.query(
        `INSERT INTO loans (household_id, name, outstanding_paise, emi_monthly_paise, rate_pct, secured_asset_id)
         VALUES ($1,$2,$3,$4,$5,$6)`,
        [
          householdId, l.name, rupeesToPaise(l.outstanding), rupeesToPaise(l.emiMonthly),
          l.ratePct ?? null, l.securedAgainstAssetId ? idMap.get(l.securedAgainstAssetId) ?? null : null,
        ]
      );
    }
    await client.query('COMMIT');
    console.log(householdId);
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
