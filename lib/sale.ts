import type { PoolClient } from "pg";
import { trackServerEvent } from "./analytics";
import { lockBoard, withTransaction } from "./db";
import { sendConfirmation, sendGift } from "./email";
import { applySale, splitAmount } from "./pricing";
import { reconcileBoard } from "./reconcile";
import { announceCurrentHour } from "./side-effects";
import { firstFreeSlug, slugify } from "./slug";
import { currentHourStart } from "./time";

export type SaleInput = {
  kind: "hour" | "wall";
  reservationId: string | null;
  slotId: string | null;
  orderId: string;
  pricePaid: number;
  email: string | null;
};

export type SaleOutcome =
  | {
      status: "applied";
      kind: "hour";
      slotIds: string[];
      slug: string;
      startsAt: Date;
      blockHours: number;
      /** Days covered when this was a standing hour; 0 otherwise. */
      standingDays: number;
      /** The last hour the purchase covers -- the standing run's final day. */
      endsAt: Date;
      /** Who paid, when the hour was a gift. The recipient is xHandle/display_name. */
      gifterHandle: string | null;
      recipientHandle: string | null;
      newPrice: number;
      displayName: string;
      buyerEmail: string | null;
    }
  | { status: "applied"; kind: "wall"; entryId: string; slug: string; amountPaid: number }
  | { status: "duplicate"; slug: string | null }
  | { status: "no_slot" };

type ReservationRow = {
  kind: string;
  slot_id: string | null;
  block_hours: number;
  buyer_email: string | null;
  display_name: string | null;
  url: string | null;
  pitch: string | null;
  x_handle: string | null;
  gifter_handle: string | null;
  standing_days: number;
  locked_price: number;
  amount: number | null;
};

/**
 * Records a purchase -- an hour, a block of hours, or a permanent Wall spot -- and moves
 * the board where the purchase says it should move. Idempotent on the payment provider's
 * order id, because webhooks retry and a double-apply would bump P twice off one sale.
 *
 * Every purchase of either kind produces exactly one wall_entries row. That row, not the
 * slot, is what holds the slug, the public page and the amount that ranks it on the Wall.
 */
export async function applyPaidOrder(input: SaleInput): Promise<SaleOutcome> {
  // Settle any owed decay first. The catch-up exempts hours containing a sale by looking
  // at sold_at, so applying the sale afterwards needs no special handling of last_decay_at.
  await reconcileBoard();

  const outcome = await withTransaction<SaleOutcome>(async (client) => {
    // Serialised even for a Wall spot, which moves no price: slug assignment reads the
    // taken slugs and then picks one, and that cannot race another checkout.
    await lockBoard(client);

    const seen = await client.query<{ slug: string | null }>(
      `SELECT slug FROM wall_entries WHERE ls_order_id = $1`,
      [input.orderId],
    );
    if (seen.rows[0]) return { status: "duplicate", slug: seen.rows[0].slug };

    const reservation = input.reservationId
      ? (
          await client.query<ReservationRow>(
            `SELECT kind, slot_id::text AS slot_id, block_hours, buyer_email, display_name,
                    url, pitch, x_handle, gifter_handle, standing_days, locked_price, amount
               FROM reservations WHERE id = $1`,
            [input.reservationId],
          )
        ).rows[0]
      : undefined;

    // The webhook's total is authoritative -- it is what the buyer was actually charged.
    const amountPaid = input.pricePaid || reservation?.amount || reservation?.locked_price || 0;
    const kind = (reservation?.kind ?? input.kind) === "wall" ? "wall" : "hour";

    if (kind === "wall") {
      return applyWallSpot(client, input, reservation, amountPaid);
    }
    return applyHourBlock(client, input, reservation, amountPaid);
  });

  await runPostSaleEffects(outcome, input);
  return outcome;
}

/**
 * The slug is assigned once and never recomputed -- every posted link and every cached
 * card depends on it. lockBoard() serialises all sales, so reading the taken slugs and
 * then picking cannot race another checkout.
 */
async function assignSlug(client: PoolClient, displayName: string): Promise<string> {
  const base = slugify(displayName);
  const taken = await client.query<{ slug: string }>(
    `SELECT slug FROM wall_entries WHERE slug = $1 OR slug LIKE $1 || '-%'`,
    [base],
  );
  return firstFreeSlug(base, taken.rows.map((r) => r.slug));
}

async function insertEntry(
  client: PoolClient,
  kind: "hour" | "wall",
  input: SaleInput,
  reservation: ReservationRow | undefined,
  amountPaid: number,
  slug: string,
): Promise<string> {
  const rows = await client.query<{ id: string }>(
    `INSERT INTO wall_entries
       (kind, amount_paid, display_name, url, pitch, x_handle, buyer_email, slug,
        ls_order_id, gifter_handle, standing_days)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
     RETURNING id::text AS id`,
    [
      kind,
      amountPaid,
      reservation?.display_name ?? "Unnamed",
      reservation?.url ?? null,
      reservation?.pitch ?? null,
      reservation?.x_handle ?? null,
      reservation?.buyer_email ?? input.email,
      slug,
      input.orderId,
      reservation?.gifter_handle ?? null,
      reservation?.standing_days ?? 0,
    ],
  );
  return rows.rows[0].id;
}

/**
 * A Wall spot is pure ranking: it consumes no hour, so it must not touch the calendar,
 * and it buys no airtime, so it must not move the floor or break a silent run.
 */
async function applyWallSpot(
  client: PoolClient,
  input: SaleInput,
  reservation: ReservationRow | undefined,
  amountPaid: number,
): Promise<SaleOutcome> {
  const slug = await assignSlug(client, reservation?.display_name ?? "Unnamed");
  const entryId = await insertEntry(client, "wall", input, reservation, amountPaid, slug);

  if (input.reservationId) {
    await client.query(`UPDATE reservations SET status = 'completed' WHERE id = $1`, [
      input.reservationId,
    ]);
  }

  return { status: "applied", kind: "wall", entryId, slug, amountPaid };
}

/**
 * One or more consecutive hours bought together. The whole block is ONE sale: one Wall
 * entry holding the full amount, and one x1.20 move of the floor however many hours it
 * covers. Each hour still gets its own slot row, claim number and X announcement.
 */
async function applyHourBlock(
  client: PoolClient,
  input: SaleInput,
  reservation: ReservationRow | undefined,
  amountPaid: number,
): Promise<SaleOutcome> {
  let slots = await lockReservedSlots(client, input.reservationId);

  if (slots.length === 0) {
    // The reservation is gone or its hours have passed. Fall back to the hour the order
    // named, then to the earliest hour still open, so a late webhook never takes money
    // for nothing.
    const preferred = reservation?.slot_id ?? input.slotId;
    const direct = await client.query<{ id: string; starts_at: Date }>(
      `SELECT id::text AS id, starts_at FROM slots
        WHERE id = $1
          AND starts_at + interval '1 hour' > now()
          AND status IN ('open','reserved')
        FOR UPDATE`,
      [preferred],
    );
    slots = direct.rows;

    if (slots.length === 0) {
      const fallback = await client.query<{ id: string; starts_at: Date }>(
        `SELECT id::text AS id, starts_at FROM slots
          WHERE status = 'open' AND starts_at > now()
          ORDER BY starts_at ASC LIMIT 1 FOR UPDATE`,
      );
      slots = fallback.rows;
      if (slots.length > 0) {
        console.warn(
          `reserved hours for order ${input.orderId} were unavailable; ` +
            `reassigned to slot ${slots[0].id}`,
        );
      }
    }
  }

  if (slots.length === 0) {
    console.error(`order ${input.orderId} paid but no slot could be assigned`);
    return { status: "no_slot" };
  }

  const displayName = reservation?.display_name ?? "Unnamed";
  const slug = await assignSlug(client, displayName);
  const entryId = await insertEntry(client, "hour", input, reservation, amountPaid, slug);

  // The entry holds the full amount -- that is what ranks them on the Wall. Each hour
  // holds only its share, so no per-hour surface ever overstates what was paid, and the
  // shares add back up to the amount exactly.
  const shares = splitAmount(amountPaid, slots.length);

  const standingDays = reservation?.standing_days ?? 0;
  // Denormalised onto every day of a standing run so any calendar row can say what it
  // is holding and until when, without reaching back to the Wall entry.
  const standingThrough =
    standingDays > 0 ? new Date(slots[slots.length - 1].starts_at) : null;

  for (const [i, slot] of slots.entries()) {
    await client.query(
      `UPDATE slots
          SET status = 'sold',
              wall_entry_id = $2,
              buyer_email = $3,
              display_name = $4,
              url = $5,
              pitch = $6,
              x_handle = $7,
              price_paid = $8,
              sold_at = now(),
              ls_order_id = $9,
              gifter_handle = $10,
              standing_through = $11,
              claim_number = nextval('claim_number_seq')
        WHERE id = $1`,
      [
        slot.id,
        entryId,
        reservation?.buyer_email ?? input.email,
        displayName,
        reservation?.url ?? null,
        reservation?.pitch ?? null,
        reservation?.x_handle ?? null,
        shares[i],
        input.orderId,
        reservation?.gifter_handle ?? null,
        standingThrough,
      ],
    );
  }

  if (input.reservationId) {
    await client.query(`UPDATE reservations SET status = 'completed' WHERE id = $1`, [
      input.reservationId,
    ]);
  }

  // One sale, one move, whatever it cost. Paying above the floor buys rank on the Wall,
  // not a bigger bump -- and a six-hour block is still one buyer saying yes once.
  const boardRows = await client.query<{ price: number; all_time_high_floor: number }>(
    `SELECT price, all_time_high_floor FROM board WHERE id = 1 FOR UPDATE`,
  );
  const board = boardRows.rows[0];
  const allTimeHigh = Math.max(board.all_time_high_floor, board.price);
  const newPrice = applySale(board.price, allTimeHigh);

  await client.query(
    `UPDATE board
        SET price = $1,
            last_sale_at = now(),
            silent_hours = 0,
            all_time_high_floor = GREATEST(all_time_high_floor, $1)
      WHERE id = 1`,
    [newPrice],
  );

  return {
    status: "applied",
    kind: "hour",
    slotIds: slots.map((s) => s.id),
    slug,
    startsAt: new Date(slots[0].starts_at),
    blockHours: standingDays > 0 ? 1 : slots.length,
    standingDays,
    endsAt: new Date(slots[slots.length - 1].starts_at),
    gifterHandle: reservation?.gifter_handle ?? null,
    recipientHandle: reservation?.x_handle ?? null,
    newPrice,
    // The stored name may be the "Unnamed" placeholder; an email must not say that.
    displayName: reservation?.display_name ?? "Your product",
    buyerEmail: reservation?.buyer_email ?? input.email,
  };
}

/** Every hour of the reserved block that can still be delivered, oldest first. */
async function lockReservedSlots(
  client: PoolClient,
  reservationId: string | null,
): Promise<{ id: string; starts_at: Date }[]> {
  if (!reservationId) return [];
  const rows = await client.query<{ id: string; starts_at: Date }>(
    `SELECT s.id::text AS id, s.starts_at
       FROM reservation_slots rs
       JOIN slots s ON s.id = rs.slot_id
      WHERE rs.reservation_id = $1
        AND s.starts_at + interval '1 hour' > now()
        AND s.status IN ('open','reserved')
      ORDER BY s.starts_at ASC
        FOR UPDATE OF s`,
    [reservationId],
  );
  return rows.rows;
}

/**
 * Everything that reaches outside the database, run after the transaction commits so a
 * dead credential can never roll back a paid order.
 */
async function runPostSaleEffects(outcome: SaleOutcome, input: SaleInput): Promise<void> {
  if (outcome.status !== "applied") return;

  if (outcome.kind === "wall") {
    // No X post: a Wall spot buys no airtime, and there is nothing to announce as live.
    // No email of ours either -- Lemon Squeezy is Merchant of Record and sends a receipt.
    void trackServerEvent("wall_spot_purchased", {
      entryId: outcome.entryId,
      amountPaid: outcome.amountPaid,
    });
    return;
  }

  void trackServerEvent(
    "slot_purchased",
    {
      slotId: outcome.slotIds[0],
      blockHours: outcome.blockHours,
      pricePaid: input.pricePaid,
      newBoardPrice: outcome.newPrice,
    },
    outcome.buyerEmail ?? undefined,
  );

  // A mid-hour purchase is live immediately, so it can't wait for the :00 cron to
  // announce it. announceCurrentHour claims its row with `announced = false`, so the
  // cron can never post the same hour twice. A block's later hours are announced by
  // the cron as each one arrives.
  if (outcome.startsAt.getTime() === currentHourStart().getTime()) {
    try {
      await announceCurrentHour();
    } catch (err) {
      // A dead X credential must never break a paid flow.
      console.error("mid-hour announcement failed", err);
    }
  }

  if (outcome.buyerEmail) {
    await sendConfirmation({
      to: outcome.buyerEmail,
      displayName: outcome.displayName,
      startsAt: outcome.startsAt,
      slug: outcome.slug,
      blockHours: outcome.blockHours,
      standingDays: outcome.standingDays,
      endsAt: outcome.endsAt,
    });

    // A gift has no inbox for the recipient -- only a handle -- so the note written to
    // them goes to the buyer to forward.
    if (outcome.gifterHandle && outcome.recipientHandle) {
      await sendGift({
        to: outcome.buyerEmail,
        recipientHandle: outcome.recipientHandle,
        gifterHandle: outcome.gifterHandle,
        startsAt: outcome.startsAt,
        slug: outcome.slug,
      });
    }
  }
}
