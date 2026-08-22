/**
 * Local development data only. Fills the archive and takes a few hours so the board
 * doesn't look dead while building. Never run this against production.
 *   npx tsx --env-file=.env.local scripts/seed-demo.ts
 */
import { config } from "../lib/config";
import { getPool, query } from "../lib/db";
import { applySale } from "../lib/pricing";
import { reconcileBoard } from "../lib/reconcile";
import { assignMissingSlugs } from "../lib/slug-backfill";

/**
 * Demo buyers walk the same ladder the real board does, so the seeded archive shows a
 * climbing price rather than invented round numbers. Index 0 is the most recent hour.
 */
function demoPricePaid(index: number): number {
  let price = config.boardStartPrice;
  for (let i = 0; i < 6 - index; i++) price = applySale(price, price);
  return price;
}

const PAST = [
  ["ranked.ai", "https://ranked.ai", "Get ranked everywhere you're searched. One provider. SEO, PPC, AI.", 84],
  ["limestonedigital", "https://limestonedigital.com", "Dedicated development teams from Central Asia, hired in days not months.", 40],
  ["overskill.com", "https://overskill.com", "Build production-ready apps in minutes with AI.", 112],
  ["trycomp.ai", "https://trycomp.ai", "Automate SOC 2, ISO 27001, HIPAA and GDPR. Audit-ready in days.", 61],
  ["fiber.so", "https://fiber.so", "The private wallet for your stablecoins.", 27],
];

const UPCOMING = [
  [3, "outrank.so"],
  [7, "mytb.ai"],
] as const;

async function main() {
  if (process.env.NODE_ENV === "production") {
    throw new Error("refusing to seed demo data in production");
  }

  await query(`DELETE FROM clicks`);
  await query(`DELETE FROM wall_clicks`);
  await query(`DELETE FROM reservations`);
  await query(`DELETE FROM slots`);
  await query(`DELETE FROM wall_entries`);
  await query(
    `UPDATE board SET price = $1, last_sale_at = NULL, silent_hours = 0,
            all_time_high_floor = $1,
            last_decay_at = date_trunc('hour', now()) WHERE id = 1`,
    [config.boardStartPrice],
  );

  // Past hours, most recent first.
  for (const [i, [name, url, pitch, clicks]] of PAST.entries()) {
    await query(
      `INSERT INTO slots (starts_at, status, display_name, url, pitch, price_paid,
                          clicks, announced, reminded, completed, sold_at, buyer_email)
       VALUES (date_trunc('hour', now()) - ($1 || ' hours')::interval, 'past',
               $2, $3, $4, $5, $6, true, true, true,
               date_trunc('hour', now()) - ($7 || ' hours')::interval, 'demo@example.com')`,
      [i + 1, name, url, pitch, demoPricePaid(i), clicks, i + 4],
    );
  }

  // The hour on screen right now.
  await query(
    `INSERT INTO slots (starts_at, status, display_name, url, pitch, price_paid,
                        clicks, announced, reminded, sold_at, buyer_email)
     VALUES (date_trunc('hour', now()), 'sold', 'orynth.dev', 'https://orynth.dev',
             'Discover early-stage products, support their creators, and invest in their coins.',
             1900, 218, true, true, now() - interval '3 hours', 'demo@example.com')`,
  );

  await reconcileBoard();

  // A couple of taken future hours so the calendar shows both states.
  for (const [offset, name] of UPCOMING) {
    await query(
      `UPDATE slots
          SET status = 'sold', display_name = $2, url = 'https://example.com',
              pitch = 'Booked ahead.', price_paid = 1900, sold_at = now(),
              buyer_email = 'demo@example.com'
        WHERE starts_at = date_trunc('hour', now()) + ($1 || ' hours')::interval`,
      [offset, name],
    );
  }

  // Demo rows are inserted directly, so the Wall entry and the slug that the sale path
  // would have created have to be made here. Runs last, once every sold row exists.
  await query(
    `INSERT INTO wall_entries (kind, amount_paid, display_name, url, pitch, buyer_email,
                               created_at, source_slot_id)
     SELECT 'hour', COALESCE(price_paid, 0), display_name, url, pitch, buyer_email,
            COALESCE(sold_at, created_at), id
       FROM slots
      WHERE sold_at IS NOT NULL AND wall_entry_id IS NULL`,
  );
  await query(
    `UPDATE slots s SET wall_entry_id = e.id
       FROM wall_entries e
      WHERE e.source_slot_id = s.id AND s.wall_entry_id IS NULL`,
  );

  // A couple of Wall-only spots, so the leaderboard shows both products side by side.
  await query(
    `INSERT INTO wall_entries (kind, amount_paid, display_name, url, pitch, buyer_email, clicks)
     VALUES ('wall', 5000, 'shipfast.dev', 'https://example.com',
             'The permanent spot nobody had to wait for an hour to buy.', 'demo@example.com', 63),
            ('wall', 500, 'tinytool.app', 'https://example.com',
             'Five dollars, on the Wall forever.', 'demo@example.com', 7)`,
  );

  await assignMissingSlugs();

  await query(`UPDATE counters SET value = 11436 WHERE key = 'visits_total'`);
  await query(
    `INSERT INTO counters (key, value) VALUES ('visits_total', 11436)
     ON CONFLICT (key) DO NOTHING`,
  );

  const counts = await query<{ status: string; n: string }>(
    `SELECT status::text AS status, count(*)::text AS n FROM slots GROUP BY status ORDER BY status`,
  );
  console.log("seeded:", counts.map((c) => `${c.status}=${c.n}`).join(" "));
  await getPool().end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
