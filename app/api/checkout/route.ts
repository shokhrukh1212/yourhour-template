import { NextResponse } from "next/server";
import { config, isLemonSqueezyConfigured } from "@/lib/config";
import { lockBoard, withTransaction } from "@/lib/db";
import { createCheckout } from "@/lib/lemonsqueezy";
import { fetchUrlMetadata } from "@/lib/metadata";
import { query } from "@/lib/db";
import {
  WALL_MIN_CENTS,
  blockMinimum,
  formatPrice,
  hourPrice,
  standingMinimum,
} from "@/lib/pricing";
import { reconcileBoard } from "@/lib/reconcile";
import { HOUR_MS, liveHourIsClaimable } from "@/lib/time";
import { validateClaim } from "@/lib/validate";

export const dynamic = "force-dynamic";

function fail(error: string, status = 400) {
  return NextResponse.json({ error }, { status });
}

type Reservation = {
  id: string;
  amount: number;
  /** Null for a Wall-only purchase, which holds no hour. */
  startsAt: Date | null;
  holdMs: number;
  blockHours: number;
  /** How many daily hours a standing purchase holds. 0 when it is not one. */
  standingDays: number;
};

export async function POST(request: Request) {
  const parsed = validateClaim(await request.json().catch(() => null));
  if (!parsed.ok) return fail(parsed.error);
  const claim = parsed.value;

  // Release anything stale first so an abandoned checkout doesn't hold an hour hostage.
  await reconcileBoard();

  // Fetched before the transaction so a slow landing page doesn't hold the board lock.
  const meta = await fetchUrlMetadata(claim.url);

  let reservation: Reservation;
  try {
    reservation =
      claim.kind === "wall"
        ? await reserveWallSpot(claim, meta)
        : claim.standingDays > 0
          ? await reserveStandingHour(claim, meta)
          : await reserveHourBlock(claim, meta);
  } catch (err) {
    const code = (err as Error).message;
    if (code === "NOT_FOUND") return fail("That hour no longer exists.", 404);
    if (code === "STARTED") {
      return fail("That hour is too far along to sell. Pick a later one.", 409);
    }
    if (code === "TAKEN") return fail("Someone just took that hour. Pick another.", 409);
    if (code === "BLOCK_UNAVAILABLE") {
      return fail("That block of hours isn't open any more. Pick another.", 409);
    }
    if (code === "STANDING_UNAVAILABLE") {
      return fail("That hour isn't free on every one of those days. Pick another.", 409);
    }
    if (code.startsWith("TOO_LITTLE:")) {
      return fail(`The minimum for that is ${formatPrice(Number(code.split(":")[1]))}.`, 409);
    }
    console.error("checkout reservation failed", err);
    return fail("Could not hold that hour. Try again.", 500);
  }

  const expiresAt = new Date(Date.now() + reservation.holdMs);

  if (!isLemonSqueezyConfigured()) {
    // Local development without Lemon Squeezy credentials. Never reachable in production.
    if (process.env.NODE_ENV === "production") {
      await releaseReservation(reservation.id);
      return fail("Payments are not configured.", 503);
    }
    const devUrl = `/api/dev/complete?reservation=${reservation.id}`;
    await query(`UPDATE reservations SET ls_checkout_url = $1 WHERE id = $2`, [
      devUrl,
      reservation.id,
    ]);
    return NextResponse.json({ checkoutUrl: devUrl, devMode: true });
  }

  try {
    const checkoutUrl = await createCheckout({
      kind: claim.kind,
      priceCents: reservation.amount,
      email: claim.email,
      slotId: claim.slotId,
      reservationId: reservation.id,
      expiresAt,
      productName:
        claim.kind === "wall"
          ? meta.productName
          : `${meta.productName} — ${reservation.startsAt!.toUTCString()}`,
      blockHours: reservation.blockHours,
      standingDays: reservation.standingDays,
    });
    await query(`UPDATE reservations SET ls_checkout_url = $1 WHERE id = $2`, [
      checkoutUrl,
      reservation.id,
    ]);
    return NextResponse.json({ checkoutUrl });
  } catch (err) {
    // Don't strand the hour if the payment provider is down.
    console.error("lemon squeezy checkout failed", err);
    await releaseReservation(reservation.id);
    return fail("Checkout is unavailable right now. Try again in a moment.", 502);
  }
}

type Claim = Extract<ReturnType<typeof validateClaim>, { ok: true }>["value"];
type Meta = Awaited<ReturnType<typeof fetchUrlMetadata>>;

/**
 * Holds a run of consecutive hours and freezes their minimum for the checkout window.
 * The whole block is one purchase: one payment, one Wall entry, one move of the floor.
 */
async function reserveHourBlock(claim: Claim, meta: Meta): Promise<Reservation> {
  return withTransaction(async (client) => {
    await lockBoard(client);

    const firstRows = await client.query<{ id: string; starts_at: Date; status: string }>(
      `SELECT id::text AS id, starts_at, status::text AS status
         FROM slots WHERE id = $1 FOR UPDATE`,
      [claim.slotId],
    );
    const first = firstRows.rows[0];
    if (!first) throw new Error("NOT_FOUND");

    // A future hour is always buyable. The hour already in progress is buyable too,
    // but only for its first fifteen minutes -- after that it goes to the encore
    // buyer for free rather than selling someone a stub of an hour.
    const startsAt = new Date(first.starts_at);
    const now = new Date();
    if (startsAt <= now && !liveHourIsClaimable(startsAt, now)) throw new Error("STARTED");
    if (first.status !== "open") throw new Error("TAKEN");

    // The rest of the block, locked in the same statement so two buyers can't each be
    // told a block is theirs. generate_series makes "consecutive" a property of the
    // query rather than something the row count has to be trusted to prove.
    const restRows = await client.query<{ id: string }>(
      `SELECT s.id::text AS id
         FROM generate_series(
                $1::timestamptz + interval '1 hour',
                $1::timestamptz + (($2 - 1) || ' hours')::interval,
                interval '1 hour'
              ) AS gs
         JOIN slots s ON s.starts_at = gs AND s.status = 'open'
        ORDER BY s.starts_at ASC
          FOR UPDATE OF s`,
      [startsAt.toISOString(), claim.blockHours],
    );
    if (restRows.rows.length !== claim.blockHours - 1) throw new Error("BLOCK_UNAVAILABLE");

    const slotIds = [first.id, ...restRows.rows.map((r) => r.id)];

    const boardRows = await client.query<{ price: number }>(
      `SELECT price FROM board WHERE id = 1 FOR UPDATE`,
    );
    // The floor is the minimum, not the price. Re-derived here under the board lock
    // because the client's copy of it may be a whole quiet hour out of date.
    //
    // A single hour is quoted through hourPrice, so an unsold hour inside the last
    // half hour clears at $1. A block is quoted off the anchor hour's tier and
    // never clears -- the discount exists to fill one hour about to be wasted, not to
    // hand over three.
    const minimum =
      claim.blockHours === 1
        ? hourPrice(boardRows.rows[0].price, startsAt, now)
        : blockMinimum(boardRows.rows[0].price, startsAt, claim.blockHours);
    if (claim.amountCents < minimum) throw new Error(`TOO_LITTLE:${minimum}`);

    // Never hand out a reservation that outlives the hour it is holding. Keyed to the
    // FIRST hour of the block, which is the one that expires soonest.
    const holdMs = Math.min(
      config.reservationMinutes * 60_000,
      Math.max(startsAt.getTime() + HOUR_MS - 15 * 60_000 - now.getTime(), 60_000),
    );

    await client.query(
      `UPDATE slots SET status = 'reserved' WHERE id = ANY($1::bigint[])`,
      [slotIds],
    );

    const inserted = await client.query<{ id: string }>(
      `INSERT INTO reservations
         (kind, slot_id, block_hours, locked_price, amount, expires_at,
          buyer_email, display_name, url, pitch, x_handle, gifter_handle)
       VALUES ('hour', $1, $2, $3, $4, now() + ($5 || ' milliseconds')::interval,
               $6, $7, $8, $9, $10, $11)
       RETURNING id::text AS id`,
      [
        first.id,
        claim.blockHours,
        minimum,
        claim.amountCents,
        holdMs,
        claim.email,
        meta.productName,
        claim.url,
        meta.pitch,
        claim.xHandle,
        claim.gifterHandle,
      ],
    );
    const reservationId = inserted.rows[0].id;

    await client.query(
      `INSERT INTO reservation_slots (reservation_id, slot_id)
       SELECT $1::uuid, unnest($2::bigint[])`,
      [reservationId, slotIds],
    );

    return {
      id: reservationId,
      amount: claim.amountCents,
      startsAt,
      holdMs,
      blockHours: claim.blockHours,
      standingDays: 0,
    };
  });
}

/**
 * Holds the SAME hour of the day on each of the next N days. One payment, one Wall
 * entry, one move of the floor -- but a slot row, a claim number and an announcement
 * for every day.
 *
 * The days a standing purchase needs run past the 24-hour calendar horizon that
 * backfillOpenSlots maintains, so the rows for them are created here. ON CONFLICT makes
 * that safe against the backfill and against a second buyer arriving at the same moment.
 */
async function reserveStandingHour(claim: Claim, meta: Meta): Promise<Reservation> {
  return withTransaction(async (client) => {
    await lockBoard(client);

    const anchorRows = await client.query<{ id: string; starts_at: Date; status: string }>(
      `SELECT id::text AS id, starts_at, status::text AS status
         FROM slots WHERE id = $1 FOR UPDATE`,
      [claim.slotId],
    );
    const anchor = anchorRows.rows[0];
    if (!anchor) throw new Error("NOT_FOUND");

    const startsAt = new Date(anchor.starts_at);
    const now = new Date();
    if (startsAt <= now && !liveHourIsClaimable(startsAt, now)) throw new Error("STARTED");
    if (anchor.status !== "open") throw new Error("TAKEN");

    const days = claim.standingDays;
    // 24 hours, not interval '1 day': a calendar day is session-timezone-relative and
    // would drift by an hour across a DST change, missing the UTC-anchored slot rows.
    // The form's availability check counts in exact 24-hour steps and the two must agree.
    const series = `generate_series(
      $1::timestamptz,
      $1::timestamptz + ((($2 - 1) * 24) || ' hours')::interval,
      interval '24 hours'
    )`;

    await client.query(
      `INSERT INTO slots (starts_at) SELECT gs FROM ${series} AS gs
       ON CONFLICT (starts_at) DO NOTHING`,
      [startsAt.toISOString(), days],
    );

    // Locked in one statement, so two buyers cannot each be told the run is theirs.
    // Every day must be open: a standing hour that skips a day is not what was bought.
    const dayRows = await client.query<{ id: string; status: string }>(
      `SELECT s.id::text AS id, s.status::text AS status
         FROM ${series} AS gs
         JOIN slots s ON s.starts_at = gs
        ORDER BY s.starts_at ASC
          FOR UPDATE OF s`,
      [startsAt.toISOString(), days],
    );
    if (dayRows.rows.length !== days) throw new Error("STANDING_UNAVAILABLE");
    if (dayRows.rows.some((r) => r.status !== "open")) {
      throw new Error("STANDING_UNAVAILABLE");
    }

    const slotIds = dayRows.rows.map((r) => r.id);

    const boardRows = await client.query<{ price: number }>(
      `SELECT price FROM board WHERE id = 1 FOR UPDATE`,
    );
    // Priced off the anchor hour's tier -- the whole point of a standing hour is that
    // it is that hour, every day -- and never cleared.
    const minimum = standingMinimum(boardRows.rows[0].price, startsAt, days);
    if (claim.amountCents < minimum) throw new Error(`TOO_LITTLE:${minimum}`);

    // The first day is still the one that expires soonest, so the hold is keyed to it.
    const holdMs = Math.min(
      config.reservationMinutes * 60_000,
      Math.max(startsAt.getTime() + HOUR_MS - 15 * 60_000 - now.getTime(), 60_000),
    );

    await client.query(
      `UPDATE slots SET status = 'reserved' WHERE id = ANY($1::bigint[])`,
      [slotIds],
    );

    const inserted = await client.query<{ id: string }>(
      `INSERT INTO reservations
         (kind, slot_id, block_hours, standing_days, locked_price, amount, expires_at,
          buyer_email, display_name, url, pitch, x_handle, gifter_handle)
       VALUES ('hour', $1, 1, $2, $3, $4, now() + ($5 || ' milliseconds')::interval,
               $6, $7, $8, $9, $10, $11)
       RETURNING id::text AS id`,
      [
        anchor.id,
        days,
        minimum,
        claim.amountCents,
        holdMs,
        claim.email,
        meta.productName,
        claim.url,
        meta.pitch,
        claim.xHandle,
        claim.gifterHandle,
      ],
    );
    const reservationId = inserted.rows[0].id;

    await client.query(
      `INSERT INTO reservation_slots (reservation_id, slot_id)
       SELECT $1::uuid, unnest($2::bigint[])`,
      [reservationId, slotIds],
    );

    return {
      id: reservationId,
      amount: claim.amountCents,
      startsAt,
      holdMs,
      blockHours: 1,
      standingDays: days,
    };
  });
}

/**
 * A permanent Wall spot. Deliberately touches neither the slot calendar nor the board:
 * it buys no airtime, so it says nothing about what an hour is worth, and there is no
 * inventory to run out of. No board lock, therefore, and no hold on anything.
 */
async function reserveWallSpot(claim: Claim, meta: Meta): Promise<Reservation> {
  if (claim.amountCents < WALL_MIN_CENTS) throw new Error(`TOO_LITTLE:${WALL_MIN_CENTS}`);

  const holdMs = config.reservationMinutes * 60_000;
  const inserted = await query<{ id: string }>(
    `INSERT INTO reservations
       (kind, slot_id, block_hours, locked_price, amount, expires_at,
        buyer_email, display_name, url, pitch, x_handle)
     VALUES ('wall', NULL, 0, $1, $2, now() + ($3 || ' milliseconds')::interval,
             $4, $5, $6, $7, $8)
     RETURNING id::text AS id`,
    [
      WALL_MIN_CENTS,
      claim.amountCents,
      holdMs,
      claim.email,
      meta.productName,
      claim.url,
      meta.pitch,
      claim.xHandle,
    ],
  );

  return {
    id: inserted[0].id,
    amount: claim.amountCents,
    startsAt: null,
    holdMs,
    blockHours: 0,
    standingDays: 0,
  };
}

async function releaseReservation(reservationId: string) {
  await withTransaction(async (client) => {
    await client.query(
      `UPDATE reservations SET status = 'expired' WHERE id = $1 AND status = 'pending'`,
      [reservationId],
    );
    await client.query(
      `UPDATE slots SET status = 'open'
        WHERE id IN (SELECT slot_id FROM reservation_slots WHERE reservation_id = $1)
          AND status = 'reserved'`,
      [reservationId],
    );
  });
}
