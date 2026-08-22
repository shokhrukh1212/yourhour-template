/**
 * Wipes every slot, click and reservation and resets the board to its opening price.
 * This is the "prepare for launch" button -- run it once before you announce, then seed
 * the first 24 hours with real buyers.
 *
 *   npx tsx --env-file=.env.local scripts/reset-board.ts --confirm
 */
import { getPool, query } from "../lib/db";
import { config } from "../lib/config";
import { formatPrice } from "../lib/pricing";

async function main() {
  if (!process.argv.includes("--confirm")) {
    console.error("Refusing to wipe the board without --confirm");
    process.exit(1);
  }

  const before = await query<{ n: string }>(`SELECT count(*)::text AS n FROM slots`);
  console.log(`slots before: ${before[0].n}`);

  await query(`DELETE FROM clicks`);
  await query(`DELETE FROM wall_clicks`);
  await query(`DELETE FROM reservations`);
  await query(`DELETE FROM slots`);
  // The Wall never resets in normal operation. This script is the launch wipe, which
  // exists precisely to clear pre-launch test purchases -- and a Wall entry outlives
  // its slot, so leaving these behind would put test rows on a permanent leaderboard.
  await query(`DELETE FROM wall_entries`);
  await query(`DELETE FROM counters WHERE key LIKE 'x_posts:%'`);
  // visitors and visit_hours are deliberately NOT cleared. The header count and the
  // "about N visitors an hour" line in the honesty block are real traffic history --
  // wiping the board is about clearing out products, not rewriting the audience.
  await query(
    `UPDATE board
        SET price = $1, last_sale_at = NULL, silent_hours = 0,
            all_time_high_floor = $1, last_decay_at = date_trunc('hour', now())
      WHERE id = 1`,
    [config.boardStartPrice],
  );

  const after = await query<{ n: string }>(`SELECT count(*)::text AS n FROM slots`);
  const visitors = await query<{ n: string }>(`SELECT count(*)::text AS n FROM visitors`);
  console.log(`slots after:  ${after[0].n}`);
  console.log(`visitors kept: ${visitors[0].n}`);
  console.log(`board reset to ${formatPrice(config.boardStartPrice)}`);
  await getPool().end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
