/**
 * One-off repair after scripts/test-reconcile.ts was run against the production database
 * on 2026-08-21 and deleted every slot. Payment records were recovered from Lemon
 * Squeezy; the product URL and pitch were recovered from the live X post and a dump taken
 * shortly before the deletion.
 *
 * Rebuilds the two lost hours, renumbers the claim sequence so the public post numbers run
 * #001/#002/#003, and puts the board back on its intended ladder.
 *
 *   npx tsx --env-file=.env.local scripts/repair-2026-08-21.ts          # dry run
 *   npx tsx --env-file=.env.local scripts/repair-2026-08-21.ts --apply
 */
import { getPool } from "../lib/db";
import { applySale, formatPrice } from "../lib/pricing";

const APPLY = process.argv.includes("--apply");

// Andreas Bylund, LS orders 9275393 ($1.00) and 9275411 ($1.25).
const ANDREAS = {
  email: "andreas@andreasbylund.se",
  displayName: "X (formerly Twitter)",
  url: "https://x.com/devbylund",
  pitch: "Building for fun and glory!",
  xHandle: "@devbylund",
};

// The board price the public ladder should land on: Answerdeck's shown price, plus a sale.
const ANSWERDECK_SHOWN_PRICE = 156;
const TARGET_BOARD_PRICE = applySale(ANSWERDECK_SHOWN_PRICE, ANSWERDECK_SHOWN_PRICE); // 187

async function main() {
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");

    // --- 1. Answerdeck: renumber first, so claim_number 3 is free for nothing else. ---
    const answerdeck = await client.query(
      `UPDATE slots
          SET claim_number = 3,
              price_paid   = $1,
              slug         = 'answerdeck',
              announced    = false   -- re-announced below as #003
        WHERE ls_order_id = '9275658'
        RETURNING id::text AS id, display_name, starts_at, claim_number, price_paid, slug`,
      [ANSWERDECK_SHOWN_PRICE],
    );
    if (answerdeck.rowCount !== 1) {
      throw new Error(`expected 1 Answerdeck row, got ${answerdeck.rowCount}`);
    }

    // --- 2. Andreas hour A: the hour that already ran, id kept so the live #001 post's
    //        /r/14217 link still resolves. completed=true suppresses a retroactive email. ---
    const hourA = await client.query(
      `INSERT INTO slots (id, starts_at, status, buyer_email, display_name, url, pitch,
                          x_handle, claim_number, price_paid, clicks, announced, reminded,
                          completed, sold_at, ls_order_id, slug)
       VALUES (14217, '2026-08-21T22:00:00Z', 'past', $1, $2, $3, $4, $5,
               1, 100, 10, true, true, true,
               '2026-08-21T22:07:49Z', '9275393', 'x-formerly-twitter')
       RETURNING id::text AS id, starts_at, claim_number, price_paid, clicks, slug`,
      [ANDREAS.email, ANDREAS.displayName, ANDREAS.url, ANDREAS.pitch, ANDREAS.xHandle],
    );

    // --- 3. Andreas hour B: tomorrow 22:00 UTC. announced=false so the cron posts #002
    //        at its own hour, when "Live now" is actually true. ---
    const hourB = await client.query(
      `INSERT INTO slots (starts_at, status, buyer_email, display_name, url, pitch,
                          x_handle, claim_number, price_paid, clicks, announced, reminded,
                          completed, sold_at, ls_order_id, slug)
       VALUES ('2026-08-22T22:00:00Z', 'sold', $1, $2, $3, $4, $5,
               2, 125, 0, false, false, false,
               '2026-08-21T22:11:40Z', '9275411', 'x-formerly-twitter-2')
       ON CONFLICT (starts_at) DO UPDATE
          SET status = 'sold', buyer_email = EXCLUDED.buyer_email,
              display_name = EXCLUDED.display_name, url = EXCLUDED.url,
              pitch = EXCLUDED.pitch, x_handle = EXCLUDED.x_handle,
              claim_number = EXCLUDED.claim_number, price_paid = EXCLUDED.price_paid,
              announced = false, reminded = false, completed = false,
              sold_at = EXCLUDED.sold_at, ls_order_id = EXCLUDED.ls_order_id,
              slug = EXCLUDED.slug
       RETURNING id::text AS id, starts_at, claim_number, price_paid, slug`,
      [ANDREAS.email, ANDREAS.displayName, ANDREAS.url, ANDREAS.pitch, ANDREAS.xHandle],
    );

    // --- 4. The board, and the sequence so the next real sale is #004. ---
    await client.query(
      `UPDATE board SET price = $1, last_sale_at = '2026-08-21T22:59:54.840Z' WHERE id = 1`,
      [TARGET_BOARD_PRICE],
    );
    await client.query(`SELECT setval('claim_number_seq', 3, true)`);

    const final = await client.query(
      `SELECT id::text AS id, claim_number::text AS claim, slug, display_name, status::text AS status,
              starts_at, price_paid, clicks, announced, completed
         FROM slots WHERE display_name IS NOT NULL ORDER BY claim_number`,
    );
    const board = await client.query(`SELECT price FROM board WHERE id = 1`);
    const seq = await client.query(`SELECT last_value::text AS v FROM claim_number_seq`);

    console.table(
      final.rows.map((r) => ({
        id: r.id, claim: `#${String(r.claim).padStart(3, "0")}`, slug: r.slug,
        name: r.display_name, status: r.status,
        starts: new Date(r.starts_at).toISOString(),
        paid: formatPrice(r.price_paid), clicks: r.clicks,
        announced: r.announced, completed: r.completed,
      })),
    );
    console.log(`board price: ${formatPrice(board.rows[0].price)}`);
    console.log(`claim_number_seq at ${seq.rows[0].v} -- next sale is #004`);
    void hourA; void hourB;

    if (APPLY) {
      await client.query("COMMIT");
      console.log("\nAPPLIED");
    } else {
      await client.query("ROLLBACK");
      console.log("\nDRY RUN -- rolled back. Re-run with --apply to commit.");
    }
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
    await getPool().end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
