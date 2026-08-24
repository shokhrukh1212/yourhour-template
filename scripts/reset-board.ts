/** Removes local/test campaign data. Requires an explicit confirmation flag. */
import { getPool, query } from "../lib/db";

async function main() {
  if (!process.argv.includes("--confirm")) {
    console.error("Refusing to wipe campaigns without --confirm");
    process.exit(1);
  }
  const before = await query<{ n: string }>(`SELECT count(*)::text AS n FROM campaigns`);
  console.log(`campaigns before: ${before[0]?.n ?? 0}`);
  await query(`DELETE FROM campaign_clicks`);
  await query(`DELETE FROM checkout_intents`);
  await query(`DELETE FROM campaigns`);
  await query(`UPDATE site_config SET max_outstanding_clicks = 150, cap_recomputed_at = now() WHERE singleton = true`);
  console.log("campaigns after: 0");
  await getPool().end();
}

main().catch((error) => { console.error(error); process.exit(1); });
