/**
 * Wipes every slot, click, reservation and Wall entry. This is the "prepare for launch"
 * button -- run it once before you announce, then seed the first hours with real buyers.
 *
 *   npx tsx --env-file=.env.local scripts/reset-board.ts --confirm
 */
import { getPool, query } from "../lib/db";
import { EMPTY_WALL_TOP_CENTS, formatPrice } from "../lib/pricing";

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
  // visitors, visit_hours and counters are deliberately NOT cleared. The header count
  // and the "about N visitors an hour" line are real traffic history -- wiping the board
  // is about clearing out products, not rewriting the audience.

  const after = await query<{ n: string }>(`SELECT count(*)::text AS n FROM slots`);
  const visitors = await query<{ n: string }>(`SELECT count(*)::text AS n FROM visitors`);
  console.log(`slots after:  ${after[0].n}`);
  console.log(`visitors kept: ${visitors[0].n}`);
  // The price is derived, so emptying the Wall resets it with no write of its own.
  console.log(`#1 now costs ${formatPrice(EMPTY_WALL_TOP_CENTS)}`);
  await getPool().end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
