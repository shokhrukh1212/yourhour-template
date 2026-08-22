import type { PoolClient } from "pg";
import { config } from "./config";
import { lockBoard, query, withTransaction } from "./db";
import { SILENT_HOURS_BEFORE_DECAY, applyDecay, effectiveFloor } from "./pricing";
import { HOUR_MS } from "./time";

/** Safety valve so a long outage can't spin the catch-up loop forever. */
const MAX_DECAY_ITERATIONS = 5_000;

export type ReconcileResult = {
  ranWork: boolean;
  expiredReservations: number;
  closedHours: number;
  decaysApplied: number;
  slotsCreated: number;
};

const NOOP: ReconcileResult = {
  ranWork: false,
  expiredReservations: 0,
  closedHours: 0,
  decaysApplied: 0,
  slotsCreated: 0,
};

/**
 * Cheap read-only probe. The board is reconciled on every page render, so the common
 * case (nothing due) must not open a write transaction.
 */
async function workIsDue(): Promise<boolean> {
  const horizon = new Date(Date.now() + config.calendarHours * HOUR_MS);
  const rows = await query<{ due: boolean }>(
    `SELECT (
       (SELECT last_decay_at FROM board WHERE id = 1) < date_trunc('hour', now())
       OR EXISTS (
         SELECT 1 FROM slots
         WHERE status <> 'past' AND starts_at + interval '1 hour' <= now()
       )
       OR EXISTS (
         SELECT 1 FROM reservations r
         WHERE r.status = 'pending'
           AND (
             r.expires_at <= now()
             -- A Wall reservation holds no hour, so only its own clock can retire it.
             -- LEFT-joining here instead would make every pending Wall row look due.
             OR EXISTS (
               SELECT 1 FROM reservation_slots rs
                 JOIN slots s ON s.id = rs.slot_id
                WHERE rs.reservation_id = r.id
                  AND s.starts_at + interval '1 hour' <= now()
             )
           )
       )
       OR COALESCE((SELECT max(starts_at) FROM slots), 'epoch'::timestamptz) < $1::timestamptz
     ) AS due`,
    [horizon.toISOString()],
  );
  return rows[0]?.due === true;
}

/**
 * Brings the board in line with wall-clock time. Idempotent and safe to call
 * concurrently from every page render and from the cron tick.
 *
 * Deliberately performs NO outbound side effects (no X post, no email) because it
 * runs on reads. Those live in runDueSideEffects(), called only by the cron tick.
 */
export async function reconcileBoard(): Promise<ReconcileResult> {
  if (!(await workIsDue())) return NOOP;

  return withTransaction(async (client) => {
    await lockBoard(client);

    // Another request may have won the lock and already done the work.
    const expiredReservations = await expireReservations(client);
    const closedHours = await closeElapsedHours(client);
    const decaysApplied = await applyDecayCatchup(client);
    const slotsCreated = await backfillOpenSlots(client);

    return {
      ranWork: true,
      expiredReservations,
      closedHours,
      decaysApplied,
      slotsCreated,
    };
  });
}

/** Pending reservations that timed out, or whose hour has since ended, release the slot. */
async function expireReservations(client: PoolClient): Promise<number> {
  // The live hour is sellable for its first fifteen minutes, so "has started" is no
  // longer grounds for expiry -- only "has finished" is. Reconcile runs on every page
  // render, so the old condition would have killed a live-hour reservation instantly.
  //
  // A reservation can hold a block of consecutive hours, so expiry is decided from the
  // whole block: if ANY hour in it has finished the block can no longer be delivered.
  const res = await client.query(
    `UPDATE reservations r
        SET status = 'expired'
      WHERE r.status = 'pending'
        AND (
          r.expires_at <= now()
          OR EXISTS (
            SELECT 1 FROM reservation_slots rs
              JOIN slots s ON s.id = rs.slot_id
             WHERE rs.reservation_id = r.id
               AND s.starts_at + interval '1 hour' <= now()
          )
        )`,
  );
  // Do this independently of the update above. A previously interrupted checkout
  // can leave an orphaned `reserved` slot without a pending reservation, and that
  // hour must never remain unavailable to buyers. Because it works from the slot side
  // it releases every hour of an expired block, not just the one the reservation names.
  await client.query(
    `UPDATE slots SET status = 'open'
      WHERE status = 'reserved'
        AND starts_at + interval '1 hour' > now()
        AND NOT EXISTS (
          SELECT 1 FROM reservation_slots rs
            JOIN reservations r ON r.id = rs.reservation_id
           WHERE rs.slot_id = slots.id AND r.status = 'pending'
        )`,
  );
  return res.rowCount ?? 0;
}

/** An hour that has fully elapsed is over, sold or not. Spec section 7. */
async function closeElapsedHours(client: PoolClient): Promise<number> {
  const res = await client.query(
    `UPDATE slots SET status = 'past'
      WHERE status <> 'past'
        AND starts_at + interval '1 hour' <= now()`,
  );
  return res.rowCount ?? 0;
}

/**
 * Silence only gets expensive once it persists. Three consecutive silent clock hours
 * cost nothing; the fourth takes 5% off P and then the run restarts, so a dead night
 * steps the price down once every four hours rather than every hour. Any hour
 * containing a sale resets the run to zero as well. A Wall-only purchase is
 * deliberately not a sale here -- it buys no airtime, so it says nothing about what an
 * hour is worth.
 *
 * Underneath everything sits the ratchet: P can never fall below half of the highest it
 * has ever been, so a climb can be given back but never erased.
 *
 * Loops so that a missed cron is harmless -- P is always correct for wall-clock time
 * regardless of when the last tick actually ran.
 */
async function applyDecayCatchup(client: PoolClient): Promise<number> {
  const boardRows = await client.query<{
    price: number;
    last_decay_at: Date;
    silent_hours: number;
    all_time_high_floor: number;
  }>(
    `SELECT price, last_decay_at, silent_hours, all_time_high_floor
       FROM board WHERE id = 1 FOR UPDATE`,
  );
  const board = boardRows.rows[0];
  if (!board) throw new Error("board row is missing; run scripts/migrate.ts");

  const nowRows = await client.query<{ hour_start: Date }>(
    `SELECT date_trunc('hour', now()) AS hour_start`,
  );
  const currentHourStart = nowRows.rows[0].hour_start;

  let cursor = new Date(board.last_decay_at);
  if (cursor >= currentHourStart) return 0;

  // One query for the whole window instead of one per hour.
  const saleRows = await client.query<{ hour: Date }>(
    `SELECT DISTINCT date_trunc('hour', sold_at) AS hour
       FROM slots
      WHERE sold_at >= $1 AND sold_at < $2`,
    [cursor.toISOString(), currentHourStart.toISOString()],
  );
  const hoursWithSales = new Set(saleRows.rows.map((r) => new Date(r.hour).getTime()));

  // The high only ever moves on a sale, which happens in applyPaidOrder, not here.
  // GREATEST is defensive: a board seeded or repaired by hand may be above its record.
  const allTimeHigh = Math.max(board.all_time_high_floor, board.price);
  const floor = effectiveFloor(allTimeHigh);

  let price = board.price;
  let silent = board.silent_hours;
  let decays = 0;
  let iterations = 0;

  while (cursor < currentHourStart && iterations < MAX_DECAY_ITERATIONS) {
    if (hoursWithSales.has(cursor.getTime())) {
      silent = 0;
    } else {
      silent++;
      if (silent > SILENT_HOURS_BEFORE_DECAY) {
        price = applyDecay(price, allTimeHigh);
        decays++;
        // The grace period is per drop, not per run: charging 5% for every hour after
        // the third would halve the board overnight. Restarting here means the header's
        // "no drop for 3 more quiet hours" is true immediately after a drop lands.
        silent = 0;
      }
    }
    cursor = new Date(cursor.getTime() + HOUR_MS);
    iterations++;

    // Catch-up only ever decreases P (sales bump it at webhook time, not here), so once
    // it is on the floor the remaining hours cannot change it. Skip straight to the end,
    // carrying the silent count forward so the header still knows how quiet it has been.
    if (price === floor && hoursWithSales.size === 0) {
      // P cannot move again, so only the position within the current grace period still
      // matters. Modulo keeps it in range instead of letting a long outage bank hundreds
      // of silent hours that would then decay the board the moment it leaves the floor.
      const remaining = Math.round((currentHourStart.getTime() - cursor.getTime()) / HOUR_MS);
      if (remaining > 0) silent = (silent + remaining) % (SILENT_HOURS_BEFORE_DECAY + 1);
      cursor = currentHourStart;
      break;
    }
  }

  await client.query(
    `UPDATE board
        SET price = $1, last_decay_at = $2, silent_hours = $3,
            all_time_high_floor = GREATEST(all_time_high_floor, $4)
      WHERE id = 1`,
    [price, cursor.toISOString(), silent, allTimeHigh],
  );
  return decays;
}

/** Keep an open slot row in place for every hour out to the calendar horizon. */
async function backfillOpenSlots(client: PoolClient): Promise<number> {
  const res = await client.query(
    `INSERT INTO slots (starts_at)
     SELECT gs
       FROM generate_series(
              date_trunc('hour', now()) + interval '1 hour',
              date_trunc('hour', now()) + ($1 || ' hours')::interval,
              interval '1 hour'
            ) AS gs
     ON CONFLICT (starts_at) DO NOTHING`,
    [config.calendarHours],
  );
  return res.rowCount ?? 0;
}
