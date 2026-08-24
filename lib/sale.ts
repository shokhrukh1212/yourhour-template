import type { PoolClient } from "pg";
import { trackServerEvent } from "./analytics";
import { config } from "./config";
import { lockBoard, withTransaction } from "./db";
import { reconcileBoard } from "./reconcile";
import { firstFreeSlug, slugify } from "./slug";
import { findFirstOpenSlotBlock, getSlotBlock, isHomepageHours, type BlockSlot } from "./slot-block";
import { trackXConversion } from "./x-ads";

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
      slotId: string | null;
      slug: string;
      startsAt: Date | null;
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
  image_url: string | null;
  amount: number | null;
  hours: number | null;
  wall_amount: number | null;
  upgrade_entry_id: string | null;
  upgrade_amount: number | null;
  status: string;
  wall_entry_id: string | null;
  twclid: string | null;
};

/**
 * Records a purchase: one permanent Wall entry, ranked by its bid per hour, plus every
 * consecutive homepage hour it was assigned. Idempotent on the payment provider's order id, because webhooks
 * retry and a double-apply would put the same buyer on the Wall twice.
 *
 * The wall_entries row, not the slot, holds the slug, the public page and the rank.
 */
export async function applyPaidOrder(input: SaleInput): Promise<SaleOutcome> {
  // Close anything that has elapsed first, so a hold on a finished hour is already gone
  // by the time the fallback chain below looks for a deliverable one.
  await reconcileBoard();

  // Set inside the transaction below; read afterward to fire the ad conversion, which
  // must happen outside the transaction and only once the sale is durably committed.
  let twclid: string | null = null;

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
            `SELECT slot_id::text AS slot_id, display_name, url, pitch, image_url, amount, hours, wall_amount,
                    upgrade_entry_id::text AS upgrade_entry_id, upgrade_amount, status,
                    wall_entry_id::text AS wall_entry_id, twclid
               FROM reservations WHERE id = $1`,
            [input.reservationId],
          )
        ).rows[0]
      : undefined;
    twclid = reservation?.twclid ?? null;

    // A later upgrade replaces wall_entries.ls_order_id, so reservation completion is
    // the durable idempotency key for a delayed retry of an earlier webhook.
    if (reservation?.status === "completed") {
      const completed = reservation.wall_entry_id
        ? await client.query<{ slug: string | null }>(
            `SELECT slug FROM wall_entries WHERE id = $1`,
            [reservation.wall_entry_id],
          )
        : { rows: [] };
      return { status: "duplicate", slug: completed.rows[0]?.slug ?? null };
    }

    // The webhook's total is authoritative -- it is what the buyer was actually charged.
    const amountPaid = input.pricePaid || reservation?.amount || 0;

    if (reservation?.upgrade_entry_id && reservation.upgrade_amount !== null) {
      const upgraded = await client.query<{ id: string; slug: string | null; display_name: string | null }>(
        `UPDATE wall_entries
            SET amount_paid = $2, ls_order_id = $3
          WHERE id = $1
          RETURNING id::text AS id, slug, display_name`,
        [reservation.upgrade_entry_id, reservation.upgrade_amount, input.orderId],
      );
      const entry = upgraded.rows[0];
      if (!entry || !entry.slug) return { status: "no_slot" };

      await client.query(
        `UPDATE reservations SET status = 'completed', wall_entry_id = $2 WHERE id = $1`,
        [input.reservationId, entry.id],
      );

      return {
        status: "applied",
        entryId: entry.id,
        slotId: null,
        slug: entry.slug,
        startsAt: null,
        amountPaid,
        displayName: entry.display_name ?? reservation.display_name ?? "Unnamed",
      };
    }

    const requestedHours = reservation?.hours ?? 1;
    const hours = isHomepageHours(requestedHours) ? requestedHours : 1;
    const slots = await claimSlots(client, input, reservation, hours);
    if (!slots) {
      console.error(`order ${input.orderId} paid but no hour block could be assigned`);
      return { status: "no_slot" };
    }
    const slot = slots[0];
    const wallAmount = reservation?.wall_amount ?? amountPaid;

    const displayName = reservation?.display_name ?? "Unnamed";
    const slug = await assignSlug(client, displayName);

    const entryRows = await client.query<{ id: string }>(
      `INSERT INTO wall_entries (amount_paid, display_name, url, pitch, image_url, slug, ls_order_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING id::text AS id`,
      [
        wallAmount,
        displayName,
        reservation?.url ?? null,
        reservation?.pitch ?? null,
        reservation?.image_url ?? null,
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
              image_url = $6,
              price_paid = $7,
              sold_at = now(),
              ls_order_id = $8,
              claim_number = nextval('claim_number_seq')
        WHERE id = ANY($1::bigint[])`,
      [
        slots.map((scheduled) => scheduled.id),
        entryId,
        displayName,
        reservation?.url ?? null,
        reservation?.pitch ?? null,
        reservation?.image_url ?? null,
        wallAmount,
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
      entryId: outcome.entryId,
      amountPaid: outcome.amountPaid,
      upgrade: outcome.slotId === null,
      ...(outcome.slotId ? { slotId: outcome.slotId } : {}),
    });
    void trackXConversion({
      orderId: input.orderId,
      amountPaidCents: outcome.amountPaid,
      eventSourceUrl: `${config.siteUrl}/u/${outcome.slug}`,
      twclid,
    });
  }
  return outcome;
}

/**
 * The consecutive hour block this order gets, locked against a concurrent sale.
 *
 * Prefers the hour the checkout reserved, so the hour quoted before payment is the hour
 * delivered after it. Falls back to the hour the order named and then to the earliest
 * hour still open, so a late webhook never takes money for nothing.
 */
async function claimSlots(
  client: PoolClient,
  input: SaleInput,
  reservation: ReservationRow | undefined,
  hours: 1 | 2 | 3 | 6,
): Promise<BlockSlot[] | null> {
  const preferred = reservation?.slot_id ?? input.slotId;

  if (preferred) {
    const direct = await client.query<{ starts_at: Date }>(
      `SELECT starts_at FROM slots WHERE id = $1 FOR UPDATE`,
      [preferred],
    );
    if (direct.rows[0]) {
      const block = await getSlotBlock(
        client,
        new Date(direct.rows[0].starts_at),
        hours,
        ["open", "reserved"],
      );
      if (block && block[0].starts_at.getTime() > Date.now()) return block;
    }
  }

  const fallback = await findFirstOpenSlotBlock(client, hours, new Date());
  if (fallback[0]) {
    console.warn(
      `reserved hour block for order ${input.orderId} was unavailable; ` +
        `reassigned to slot ${fallback[0].id}`,
    );
    return fallback;
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
