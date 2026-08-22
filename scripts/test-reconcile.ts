/**
 * Integration test for the reconciler.
 *
 * DESTRUCTIVE: this deletes every slot, click and reservation, and rewrites the board
 * price. It is meant for a scratch database. It refuses to run against a database that
 * holds completed orders, because .env.local points at production.
 *
 *   npx tsx --env-file=.env.local scripts/test-reconcile.ts
 */
import assert from "node:assert/strict";
import { getPool, query } from "../lib/db";
import { reconcileBoard } from "../lib/reconcile";
import { getBoard, getUpcomingSlots } from "../lib/slots";
import { config } from "../lib/config";

async function reset(price: number, decayHoursAgo: number, allTimeHigh = price) {
  await query(
    `UPDATE board
        SET price = $1,
            last_sale_at = NULL,
            silent_hours = 0,
            all_time_high_floor = $3,
            last_decay_at = date_trunc('hour', now()) - ($2 || ' hours')::interval
      WHERE id = 1`,
    [price, decayHoursAgo, allTimeHigh],
  );
}

let failures = 0;
async function check(name: string, fn: () => Promise<void>) {
  try {
    await fn();
    console.log(`  ok  ${name}`);
  } catch (err) {
    failures++;
    console.error(`FAIL  ${name}\n      ${(err as Error).message}`);
  }
}

/**
 * A paid order is the one thing here that cannot be regenerated, so it is the tripwire.
 * --i-know-this-wipes-real-sales exists only so the refusal can be overridden knowingly.
 *
 * This script has destroyed a production board once already -- see the header of
 * scripts/repair-2026-08-21.ts. Both tables are checked, because a Wall entry outlives
 * its slot and a Wall-only purchase has no slot at all: looking at slots alone would let
 * a database full of real Wall purchases sail straight past the refusal.
 */
async function refuseIfRealSales(): Promise<void> {
  if (process.argv.includes("--i-know-this-wipes-real-sales")) return;
  const rows = await query<{ slots: string; entries: string }>(
    `SELECT (SELECT count(*) FROM slots WHERE ls_order_id IS NOT NULL)::text AS slots,
            (SELECT count(*) FROM wall_entries)::text AS entries`,
  );
  const orders = Number(rows[0]?.slots ?? 0);
  const entries = Number(rows[0]?.entries ?? 0);
  if (orders === 0 && entries === 0) return;

  console.error(
    `Refusing to run: this database holds ${orders} completed order(s) and ` +
      `${entries} Wall entr${entries === 1 ? "y" : "ies"}.\n` +
      `These tests DELETE every slot and every Wall entry, and The Wall is permanent --\n` +
      `there is nothing to restore it from. Point DATABASE_URL at a scratch database\n` +
      `(a Neon branch works well), or pass --i-know-this-wipes-real-sales.`,
  );
  await getPool().end();
  process.exit(1);
}

async function main() {
  await refuseIfRealSales();

  await query(`DELETE FROM clicks`);
  await query(`DELETE FROM wall_clicks`);
  await query(`DELETE FROM reservations`);
  await query(`DELETE FROM slots`);
  await query(`DELETE FROM wall_entries`);

  await check("three silent hours cost nothing at all", async () => {
    await reset(1900, 3);
    const result = await reconcileBoard();
    assert.equal(result.decaysApplied, 0, "the first three quiet hours are free");
    assert.equal((await getBoard()).price, 1900);
    assert.equal((await getBoard()).silent_hours, 3, "but the run is being counted");
  });

  await check("the fourth silent hour and onward take 5% each", async () => {
    await reset(1900, 6);
    const result = await reconcileBoard();
    assert.equal(result.decaysApplied, 3, "hours 4, 5 and 6 decay");
    // 1900 -> 1805 -> 1715 -> 1629
    assert.equal((await getBoard()).price, 1629);
    assert.equal((await getBoard()).silent_hours, 6);
  });

  await check("a second reconcile in the same hour is a no-op", async () => {
    const before = await getBoard();
    const result = await reconcileBoard();
    assert.equal(result.decaysApplied, 0, "must not double-decay");
    assert.equal((await getBoard()).price, before.price);
    assert.equal((await getBoard()).silent_hours, before.silent_hours);
  });

  await check("a sale resets the run, so the hours after it are free again", async () => {
    await query(`DELETE FROM slots`);
    await reset(2000, 3);
    // A sale landed inside the hour that ended three hours ago, so only two silent
    // hours have accumulated since -- not enough to cost anything yet.
    await query(
      `INSERT INTO slots (starts_at, status, display_name, url, pitch, price_paid, sold_at)
       VALUES (date_trunc('hour', now()) + interval '5 hours', 'sold', 'seed.dev',
               'https://seed.dev', 'seeded', 2000,
               date_trunc('hour', now()) - interval '3 hours' + interval '10 minutes')`,
    );
    const result = await reconcileBoard();
    assert.equal(result.decaysApplied, 0, "the sale restarted the count");
    assert.equal((await getBoard()).price, 2000);
    assert.equal((await getBoard()).silent_hours, 2);
  });

  await check("the ratchet holds P at half its all-time high", async () => {
    await query(`DELETE FROM slots`);
    await reset(4000, 200, 4000);
    await reconcileBoard();
    assert.equal((await getBoard()).price, 2000, "a $40 board never sells under $20");
  });

  await check("decay never falls below the opening floor", async () => {
    await query(`DELETE FROM slots`);
    await reset(150, 200, 150);
    await reconcileBoard();
    assert.equal((await getBoard()).price, config.priceFloor);
  });

  await check("a Wall-only purchase is not a sale and does not break the run", async () => {
    await query(`DELETE FROM slots`);
    await query(`DELETE FROM wall_entries`);
    await reset(2000, 6);
    await query(
      `INSERT INTO wall_entries (kind, amount_paid, display_name, url, slug, created_at)
       VALUES ('wall', 5000, 'wallonly.dev', 'https://wallonly.dev', 'wallonly-dev',
               date_trunc('hour', now()) - interval '2 hours')`,
    );
    const result = await reconcileBoard();
    assert.equal(result.decaysApplied, 3, "it buys no airtime, so it says nothing about P");
    // Three free hours, then 2000 -> 1900 -> 1805 -> 1715.
    assert.equal((await getBoard()).price, 1715);
  });

  await check("backfills a full calendar of open hours", async () => {
    await query(`DELETE FROM slots`);
    await reset(1900, 0);
    await reconcileBoard();
    const upcoming = await getUpcomingSlots();
    assert.equal(upcoming.length, config.calendarHours, "calendar should be full");
    assert.ok(upcoming.every((s) => s.status === "open"));
  });

  await check("closes an hour that has fully elapsed", async () => {
    await query(
      `INSERT INTO slots (starts_at, status, display_name, url, pitch, price_paid, sold_at)
       VALUES (date_trunc('hour', now()) - interval '3 hours', 'sold', 'past.dev',
               'https://past.dev', 'already over', 1500, now() - interval '3 hours')
       ON CONFLICT (starts_at) DO NOTHING`,
    );
    await reconcileBoard();
    const rows = await query<{ status: string }>(
      `SELECT status FROM slots WHERE starts_at = date_trunc('hour', now()) - interval '3 hours'`,
    );
    assert.equal(rows[0].status, "past");
  });

  await check("an expired reservation returns the slot to open", async () => {
    const slot = await query<{ id: string }>(
      `SELECT id::text AS id FROM slots WHERE status = 'open' AND starts_at > now()
        ORDER BY starts_at LIMIT 1`,
    );
    const slotId = slot[0].id;
    await query(`UPDATE slots SET status = 'reserved' WHERE id = $1`, [slotId]);
    await query(
      `INSERT INTO reservations (slot_id, locked_price, expires_at, status)
       VALUES ($1, 1900, now() - interval '1 minute', 'pending')`,
      [slotId],
    );
    const result = await reconcileBoard();
    assert.equal(result.expiredReservations, 1);
    const after = await query<{ status: string }>(
      `SELECT status FROM slots WHERE id = $1`,
      [slotId],
    );
    assert.equal(after[0].status, "open", "slot must be buyable again");
  });

  await check("a live-hour reservation survives reconcile", async () => {
    // Reconcile runs on every page render. Before the live hour became sellable this
    // expired any reservation whose hour had started, which would kill a live-hour
    // checkout within milliseconds of it being created.
    await query(`DELETE FROM reservations`);
    await query(
      `INSERT INTO slots (starts_at, status)
       VALUES (date_trunc('hour', now()), 'reserved')
       ON CONFLICT (starts_at) DO UPDATE SET status = 'reserved'`,
    );
    const live = await query<{ id: string }>(
      `SELECT id::text AS id FROM slots WHERE starts_at = date_trunc('hour', now())`,
    );
    await query(
      `INSERT INTO reservations (slot_id, locked_price, expires_at, status)
       VALUES ($1, 100, now() + interval '9 minutes', 'pending')`,
      [live[0].id],
    );

    await reconcileBoard();

    const res = await query<{ status: string }>(
      `SELECT status FROM reservations WHERE slot_id = $1`,
      [live[0].id],
    );
    assert.equal(res[0].status, "pending", "live-hour reservation must not be expired");
    const slot = await query<{ status: string }>(
      `SELECT status FROM slots WHERE id = $1`,
      [live[0].id],
    );
    assert.equal(slot[0].status, "reserved", "slot must stay held for the buyer");
  });

  await check("a reservation on a finished hour is still expired", async () => {
    await query(`DELETE FROM reservations`);
    await query(
      `INSERT INTO slots (starts_at, status)
       VALUES (date_trunc('hour', now()) - interval '2 hours', 'reserved')
       ON CONFLICT (starts_at) DO UPDATE SET status = 'reserved'`,
    );
    const over = await query<{ id: string }>(
      `SELECT id::text AS id FROM slots
        WHERE starts_at = date_trunc('hour', now()) - interval '2 hours'`,
    );
    await query(
      `INSERT INTO reservations (slot_id, locked_price, expires_at, status)
       VALUES ($1, 100, now() + interval '9 minutes', 'pending')`,
      [over[0].id],
    );

    await reconcileBoard();

    const res = await query<{ status: string }>(
      `SELECT status FROM reservations WHERE slot_id = $1`,
      [over[0].id],
    );
    assert.equal(res[0].status, "expired", "a finished hour releases its reservation");
  });

  // Leave the board in a sane state for the dev server.
  await query(`DELETE FROM reservations`);
  await query(`DELETE FROM slots`);
  await reset(config.boardStartPrice, 0);
  await reconcileBoard();

  await getPool().end();
  console.log(failures === 0 ? "\nall reconcile checks passed" : `\n${failures} FAILED`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
