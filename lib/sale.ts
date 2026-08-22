import type { PoolClient } from "pg";
import { trackServerEvent } from "./analytics";
import { lockBoard, withTransaction } from "./db";
import { reconcileBoard } from "./reconcile";
import { firstFreeSlug, slugify } from "./slug";

export type SaleInput = {
  reservationId: string | null;
  slotId: string | null;
  orderId: string;
  pricePaid: number;
};

export type SaleOutcome =
  | {
      status: "applied";
      entryId: string;
      slotId: string;
      slug: string;
      startsAt: Date;
      amountPaid: number;
      displayName: string;
    }
  | { status: "duplicate"; slug: string | null }
  | { status: "no_slot" };

type ReservationRow = {
  slot_id: string | null;
  display_name: string | null;
  url: string | null;
  pitch: string | null;
  amount: number | null;
};

/**
 * Records a purchase: one permanent Wall entry, ranked by what was paid, plus the one
 * hour it was assigned. Idempotent on the payment provider's order id, because webhooks
 * retry and a double-apply would put the same buyer on the Wall twice.
 *
 * The wall_entries row, not the slot, holds the slug, the public page and the rank.
 */
export async function applyPaidOrder(input: SaleInput): Promise<SaleOutcome> {
  // Close anything that has elapsed first, so a hold on a finished hour is already gone
  // by the time the fallback chain below looks for a deliverable one.
  await reconcileBoard();

  const outcome = await withTransaction<SaleOutcome>(async (client) => {
    // Slug assignment reads the taken slugs and then picks one, which cannot race
    // another checkout. Slot assignment cannot race one either.
    await lockBoard(client);

    const seen = await client.query<{ slug: string | null }>(
      `SELECT slug FROM wall_entries WHERE ls_order_id = $1`,
      [input.orderId],
    );
    if (seen.rows[0]) return { status: "duplicate", slug: seen.rows[0].slug };

    const reservation = input.reservationId
      ? (
          await client.query<ReservationRow>(
            `SELECT slot_id::text AS slot_id, display_name, url, pitch, amount
               FROM reservations WHERE id = $1`,
            [input.reservationId],
          )
        ).rows[0]
      : undefined;

    // The webhook's total is authoritative -- it is what the buyer was actually charged.
    const amountPaid = input.pricePaid || reservation?.amount || 0;

    const slot = await claimSlot(client, input, reservation);
    if (!slot) {
      console.error(`order ${input.orderId} paid but no slot could be assigned`);
      return { status: "no_slot" };
    }

    const displayName = reservation?.display_name ?? "Unnamed";
    const slug = await assignSlug(client, displayName);

    const entryRows = await client.query<{ id: string }>(
      `INSERT INTO wall_entries (amount_paid, display_name, url, pitch, slug, ls_order_id)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id::text AS id`,
      [
        amountPaid,
        displayName,
        reservation?.url ?? null,
        reservation?.pitch ?? null,
        slug,
        input.orderId,
      ],
    );
    const entryId = entryRows.rows[0].id;

    await client.query(
      `UPDATE slots
          SET status = 'sold',
              wall_entry_id = $2,
              display_name = $3,
              url = $4,
              pitch = $5,
              price_paid = $6,
              sold_at = now(),
              ls_order_id = $7,
              claim_number = nextval('claim_number_seq')
        WHERE id = $1`,
      [
        slot.id,
        entryId,
        displayName,
        reservation?.url ?? null,
        reservation?.pitch ?? null,
        amountPaid,
        input.orderId,
      ],
    );

    if (input.reservationId) {
      // wall_entry_id is what /success looks the sale up by: the slug is only decided
      // here, inside the transaction, so the redirect cannot be told it in advance.
      await client.query(
        `UPDATE reservations SET status = 'completed', wall_entry_id = $2 WHERE id = $1`,
        [input.reservationId, entryId],
      );
    }

    return {
      status: "applied",
      entryId,
      slotId: slot.id,
      slug,
      startsAt: new Date(slot.starts_at),
      amountPaid,
      displayName,
    };
  });

  if (outcome.status === "applied") {
    void trackServerEvent("slot_purchased", {
      slotId: outcome.slotId,
      entryId: outcome.entryId,
      amountPaid: outcome.amountPaid,
    });
  }
  return outcome;
}

/**
 * The hour this order gets, locked against a concurrent sale.
 *
 * Prefers the hour the checkout reserved, so the hour quoted before payment is the hour
 * delivered after it. Falls back to the hour the order named and then to the earliest
 * hour still open, so a late webhook never takes money for nothing.
 */
async function claimSlot(
  client: PoolClient,
  input: SaleInput,
  reservation: ReservationRow | undefined,
): Promise<{ id: string; starts_at: Date } | null> {
  const preferred = reservation?.slot_id ?? input.slotId;

  if (preferred) {
    const direct = await client.query<{ id: string; starts_at: Date }>(
      `SELECT id::text AS id, starts_at FROM slots
        WHERE id = $1
          AND starts_at + interval '1 hour' > now()
          AND status IN ('open','reserved')
        FOR UPDATE`,
      [preferred],
    );
    if (direct.rows[0]) return direct.rows[0];
  }

  const fallback = await client.query<{ id: string; starts_at: Date }>(
    `SELECT id::text AS id, starts_at FROM slots
      WHERE status = 'open' AND starts_at > now()
      ORDER BY starts_at ASC LIMIT 1 FOR UPDATE`,
  );
  if (fallback.rows[0]) {
    console.warn(
      `reserved hour for order ${input.orderId} was unavailable; ` +
        `reassigned to slot ${fallback.rows[0].id}`,
    );
    return fallback.rows[0];
  }
  return null;
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
