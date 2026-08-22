/**
 * Local development data only. Fills the Wall and takes a few hours so the site doesn't
 * look dead while building. Never run this against production.
 *   npx tsx --env-file=.env.local scripts/seed-demo.ts
 */
import { getPool, query } from "../lib/db";
import { reconcileBoard } from "../lib/reconcile";
import { assignMissingSlugs } from "../lib/slug-backfill";

/**
 * Demo buyers climb the same ladder the real Wall does -- each one takes #1 from the
 * last -- so the seeded Wall shows a rising price rather than invented round numbers.
 * Index 0 is the most recent hour, so the earliest buyer paid least.
 */
function demoAmount(index: number): number {
  return 500 + (5 - index) * 100;
}

const PAST = [
  ["ranked.ai", "https://ranked.ai", "Get ranked everywhere you're searched. One provider. SEO, PPC, AI.", 84],
  ["limestonedigital", "https://limestonedigital.com", "Dedicated development teams from Central Asia, hired in days not months.", 40],
  ["overskill.com", "https://overskill.com", "Build production-ready apps in minutes with AI.", 112],
  ["trycomp.ai", "https://trycomp.ai", "Automate SOC 2, ISO 27001, HIPAA and GDPR. Audit-ready in days.", 61],
  ["fiber.so", "https://fiber.so", "The private wallet for your stablecoins.", 27],
] as const;

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

  // Past hours, most recent first.
  for (const [i, [name, url, pitch, clicks]] of PAST.entries()) {
    await query(
      `INSERT INTO slots (starts_at, status, display_name, url, pitch, price_paid,
                          clicks, sold_at)
       VALUES (date_trunc('hour', now()) - ($1 || ' hours')::interval, 'past',
               $2, $3, $4, $5, $6,
               date_trunc('hour', now()) - ($7 || ' hours')::interval)`,
      [i + 1, name, url, pitch, demoAmount(i), clicks, i + 4],
    );
  }

  // The hour on screen right now.
  await query(
    `INSERT INTO slots (starts_at, status, display_name, url, pitch, price_paid,
                        clicks, sold_at)
     VALUES (date_trunc('hour', now()), 'sold', 'orynth.dev', 'https://orynth.dev',
             'Discover early-stage products, support their creators, and invest in their coins.',
             1900, 218, now() - interval '3 hours')`,
  );

  await reconcileBoard();

  // A couple of taken future hours so the calendar shows both states.
  for (const [offset, name] of UPCOMING) {
    await query(
      `UPDATE slots
          SET status = 'sold', display_name = $2, url = 'https://example.com',
              pitch = 'Booked ahead.', price_paid = 1900, sold_at = now()
        WHERE starts_at = date_trunc('hour', now()) + ($1 || ' hours')::interval`,
      [offset, name],
    );
  }

  // Demo rows are inserted directly, so the Wall entry and the slug that the sale path
  // would have created have to be made here. Runs last, once every sold row exists.
  await query(
    `INSERT INTO wall_entries (amount_paid, display_name, url, pitch, created_at, source_slot_id)
     SELECT COALESCE(price_paid, 0), display_name, url, pitch,
            COALESCE(sold_at, created_at), id
       FROM slots
      WHERE sold_at IS NOT NULL AND wall_entry_id IS NULL`,
  );
  await query(
    `UPDATE slots s SET wall_entry_id = e.id
       FROM wall_entries e
      WHERE e.source_slot_id = s.id AND s.wall_entry_id IS NULL`,
  );

  await assignMissingSlugs();

  const counts = await query<{ status: string; n: string }>(
    `SELECT status::text AS status, count(*)::text AS n FROM slots GROUP BY status ORDER BY status`,
  );
  const top = await query<{ top: number | null }>(
    `SELECT max(amount_paid) AS top FROM wall_entries`,
  );
  console.log("seeded:", counts.map((c) => `${c.status}=${c.n}`).join(" "));
  console.log(`wall top: ${top[0].top ?? 0}c — #1 costs ${(top[0].top ?? 400) + 100}c`);
  await getPool().end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
