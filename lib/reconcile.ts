import type { PoolClient } from "pg";
import { config } from "./config";
import { lockBoard, query, withTransaction } from "./db";
import { HOUR_MS } from "./time";

export type ReconcileResult = {
  ranWork: boolean;
  expiredReservations: number;
  closedHours: number;
  slotsCreated: number;
};

const NOOP: ReconcileResult = {
  ranWork: false,
  expiredReservations: 0,
  closedHours: 0,
  slotsCreated: 0,
};

/**
 * Cheap read-only probe. The calendar is reconciled on every page render, so the common
 * case (nothing due) must not open a write transaction.
 */
async function workIsDue(): Promise<boolean> {
  const horizon = new Date(Date.now() + config.calendarHours * HOUR_MS);
  const rows = await query<{ due: boolean }>(
    `SELECT (
       EXISTS (
         SELECT 1 FROM slots
         WHERE status <> 'past' AND starts_at + interval '1 hour' <= now()
       )
       OR EXISTS (
         SELECT 1 FROM reservations r
         WHERE r.status = 'pending'
           AND (
             r.expires_at <= now()
             OR EXISTS (
               SELECT 1 FROM slots s
                WHERE s.id = r.slot_id
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
 * Brings the calendar in line with wall-clock time: retires stale reservations, closes
 * hours that have finished, and keeps the next 24 hours populated. Idempotent and safe
 * to call concurrently from every page render and from the cron tick.
 *
 * Performs no outbound side effects, because it runs on reads.
 */
export async function reconcileBoard(): Promise<ReconcileResult> {
  if (!(await workIsDue())) return NOOP;

  return withTransaction(async (client) => {
    await lockBoard(client);

    // Another request may have won the lock and already done the work.
    const expiredReservations = await expireReservations(client);
    const closedHours = await closeElapsedHours(client);
    const slotsCreated = await backfillOpenSlots(client);

    return { ranWork: true, expiredReservations, closedHours, slotsCreated };
  });
}

/** Expire timed-out checkouts and undo legacy slot locks from older checkout flows. */
async function expireReservations(client: PoolClient): Promise<number> {
  const res = await client.query(
    `UPDATE reservations r
        SET status = 'expired'
      WHERE r.status = 'pending'
        AND (
          r.expires_at <= now()
          OR EXISTS (
            SELECT 1 FROM slots s
             WHERE s.id = r.slot_id
               AND s.starts_at + interval '1 hour' <= now()
          )
        )`,
  );
  // Checkout no longer reserves hours. Open any future legacy locks immediately, even
  // if their old pending reservation has not expired, so an abandoned external checkout
  // cannot make the calendar look unavailable.
  await client.query(
    `UPDATE slots SET status = 'open'
      WHERE status = 'reserved'
        AND starts_at + interval '1 hour' > now()`,
  );
  return res.rowCount ?? 0;
}

/** An hour that has fully elapsed is over, sold or not. */
async function closeElapsedHours(client: PoolClient): Promise<number> {
  const res = await client.query(
    `UPDATE slots SET status = 'past'
      WHERE status <> 'past'
        AND starts_at + interval '1 hour' <= now()`,
  );
  return res.rowCount ?? 0;
}

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
