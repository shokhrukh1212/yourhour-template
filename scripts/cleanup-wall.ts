/**
 * Removes the two junk Wall entries titled "X (formerly Twitter)".
 *
 * They are somebody's X profile scraped for a product name -- a link that says nothing
 * about what was bought, sitting permanently on a leaderboard of products. New sales
 * can't produce them any more (lib/validate.ts rejects x.com and twitter.com outright,
 * and lib/wall.ts rejects a duplicate name), but these two predate that.
 *
 * Their SLOTS are kept, clicks and all, so no counter moves: the rows are only stripped
 * of the identity that pointed at the deleted entry. `sold_at` is cleared too, because
 * the historical backfill in schema.sql used `sold_at IS NOT NULL AND wall_entry_id IS
 * NULL` to decide what to resurrect -- that block is gone now, but leaving the rows in a
 * state it would have matched is asking for trouble.
 *
 *   npx tsx --env-file=.env.local scripts/cleanup-wall.ts           # dry run
 *   npx tsx --env-file=.env.local scripts/cleanup-wall.ts --apply
 */
import { getPool, query, withTransaction } from "../lib/db";

const JUNK_NAME = "X (formerly Twitter)";

async function main() {
  const apply = process.argv.includes("--apply");

  const targets = await query<{
    id: string;
    display_name: string | null;
    amount_paid: number;
    url: string | null;
    slug: string | null;
    clicks: number;
  }>(
    `SELECT id::text AS id, display_name, amount_paid, url, slug, clicks
       FROM wall_entries WHERE display_name = $1 ORDER BY id`,
    [JUNK_NAME],
  );

  if (targets.length === 0) {
    console.log("nothing to do: no entries named", JSON.stringify(JUNK_NAME));
    await getPool().end();
    return;
  }

  const slots = await query<{ id: string; clicks: number; wall_entry_id: string }>(
    `SELECT id::text AS id, clicks, wall_entry_id::text AS wall_entry_id
       FROM slots WHERE wall_entry_id = ANY($1::bigint[]) ORDER BY id`,
    [targets.map((t) => t.id)],
  );

  console.log(`entries to delete (${targets.length}):`);
  for (const t of targets) {
    console.log(`  #${t.id} ${t.display_name} ${t.url} — ${t.amount_paid}c, ${t.clicks} wall clicks, slug ${t.slug}`);
  }
  console.log(`slots to strip (${slots.length}, clicks preserved):`);
  for (const s of slots) {
    console.log(`  slot ${s.id} — ${s.clicks} clicks kept`);
  }

  if (!apply) {
    console.log("\ndry run. re-run with --apply to make these changes.");
    await getPool().end();
    return;
  }

  await withTransaction(async (client) => {
    // The FK has no ON DELETE, so the slots must let go before the entries can go.
    await client.query(
      `UPDATE slots
          SET wall_entry_id = NULL, display_name = NULL, url = NULL, pitch = NULL,
              slug = NULL, sold_at = NULL, price_paid = NULL, ls_order_id = NULL,
              status = 'past'
        WHERE wall_entry_id = ANY($1::bigint[])`,
      [targets.map((t) => t.id)],
    );
    // wall_clicks cascades.
    await client.query(`DELETE FROM wall_entries WHERE id = ANY($1::bigint[])`, [
      targets.map((t) => t.id),
    ]);
  });

  const remaining = await query<{ n: string; top: number | null }>(
    `SELECT count(*)::text AS n, max(amount_paid) AS top FROM wall_entries`,
  );
  console.log(`\ndone. ${remaining[0].n} entries left, top is ${remaining[0].top ?? 0}c.`);
  await getPool().end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
