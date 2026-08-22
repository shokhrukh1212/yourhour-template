/**
 * Makes the CURRENT (old) database accept the NEW code, so the new build can be
 * deployed with no window in which buying is broken.
 *
 * Without this the ordering is a trap in both directions: deploy first and every
 * checkout 500s until the migration lands, migrate first and the old build's homepage
 * 500s on the missing `board` table until the deploy lands.
 *
 * All three statements are additive and safe against the old code, which supplies both
 * `locked_price` and `kind` explicitly at every insert site and never does `SELECT *`
 * on reservations. Run it BEFORE deploying; `npm run migrate` afterwards is what
 * actually removes the old columns.
 *
 * Safe to run more than once.
 *
 *   npx tsx --env-file=.env.local scripts/pre-deploy-compat.ts
 */
import { getPool, query } from "../lib/db";

async function main() {
  // The new checkout no longer freezes a price, so it inserts no locked_price.
  await query(`ALTER TABLE reservations ALTER COLUMN locked_price DROP NOT NULL`);
  console.log("  reservations.locked_price is now nullable");

  // There is only one kind of purchase now, so the new sale path stops naming it.
  await query(`ALTER TABLE wall_entries ALTER COLUMN kind SET DEFAULT 'hour'`);
  console.log("  wall_entries.kind defaults to 'hour'");

  // How /success finds the sale it just paid for.
  await query(
    `ALTER TABLE reservations ADD COLUMN IF NOT EXISTS wall_entry_id bigint
       REFERENCES wall_entries(id)`,
  );
  console.log("  reservations.wall_entry_id added");

  console.log("\nready to deploy. run `npm run migrate` once the deploy is live.");
  await getPool().end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
