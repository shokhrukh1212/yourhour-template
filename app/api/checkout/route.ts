import { NextResponse } from "next/server";
import type { PoolClient } from "pg";
import { config, isLemonSqueezyConfigured } from "@/lib/config";
import { lockBoard, withTransaction } from "@/lib/db";
import { createCheckout } from "@/lib/lemonsqueezy";
import { fetchUrlMetadata } from "@/lib/metadata";
import { MIN_ENTRY_CENTS } from "@/lib/pricing";
import { reconcileBoard } from "@/lib/reconcile";
import { HOUR_MS } from "@/lib/time";
import { type ClaimInput, validateClaim } from "@/lib/validate";
import { wallNameIsTaken, findWallEntryByUrl } from "@/lib/wall";
import { normalizeWallDomain } from "@/lib/wall-url";
import { findFirstOpenSlotBlock, getSlotBlock, type BlockSlot } from "@/lib/slot-block";

export const dynamic = "force-dynamic";

function fail(error: string, status = 400) {
  return NextResponse.json({ error }, { status });
}

type Reserved = {
  id: string;
  slotId: string | null;
  startsAt: Date | null;
  hours: number;
  amount: number;
  isUpgrade: boolean;
  displayName: string;
  imageUrl: string | null;
  /** True when the assigned hour is past the 24-hour calendar the homepage shows. */
  beyondHorizon: boolean;
  expiresAt: Date;
};

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return fail("Invalid request.");
  }

  const parsed = validateClaim(body);
  if (!parsed.ok) return fail(parsed.error);
  const claim = parsed.value;

  // Release stale holds before looking for the earliest open hour.
  await reconcileBoard();

  // Fetched before the transaction so a slow landing page doesn't hold the board lock.
  // The scrape is authoritative; the buyer's typed name is only a fallback for a page
  // we could not read at all.
  const meta = await fetchUrlMetadata(claim.url);
  const displayName = (meta.scraped ? meta.productName : claim.name ?? meta.productName).trim();
  const pitch = meta.scraped ? meta.pitch : claim.pitch ?? meta.pitch;
  const imageUrl = meta.imageUrl;

  // Re-checked here and not only in /api/preview: the preview is advisory, and two
  // buyers racing on the same name must not both get through.
  const existing = await findWallEntryByUrl(claim.url);
  if (!existing && (await wallNameIsTaken(displayName))) {
    return fail("Someone is already on the Wall as that product.", 409);
  }

  let reserved: Reserved;
  try {
    reserved = await reserve(claim, displayName, pitch, imageUrl);
  } catch (err) {
    const message = err instanceof Error ? err.message : "";
    if (message === "TAKEN") return fail("That hour has just been taken.", 409);
    if (message === "STARTED") return fail("That hour has already started.", 409);
    if (message === "NOT_FOUND") return fail("That hour is not on the board.", 404);
    if (message === "TOO_LITTLE") return fail("The minimum is $3.", 409);
    if (message === "NOT_AN_UPGRADE") {
      return fail("Choose an amount higher than your current Wall amount.", 409);
    }
    console.error("reservation failed", err);
    return fail("Could not hold that hour. Try again.", 500);
  }

  const shared = {
    slotId: reserved.slotId,
    startsAtIso: reserved.startsAt?.toISOString() ?? null,
    hours: reserved.hours,
    beyondHorizon: reserved.beyondHorizon,
    displayName: reserved.displayName,
    isUpgrade: reserved.isUpgrade,
  };

  // Without Lemon Squeezy credentials the flow completes through a local stub so the
  // whole purchase path can be exercised offline. Hard disabled in production.
  if (!isLemonSqueezyConfigured()) {
    if (process.env.NODE_ENV === "production") {
      await releaseReservation(reserved.id);
      return fail("Payments are not configured.", 503);
    }
    const devUrl = `/api/dev/complete?reservation=${reserved.id}`;
    await withTransaction(async (client) => {
      await client.query(`UPDATE reservations SET ls_checkout_url = $2 WHERE id = $1`, [
        reserved.id,
        devUrl,
      ]);
    });
    return NextResponse.json({ checkoutUrl: devUrl, devMode: true, ...shared });
  }

  try {
    const checkoutUrl = await createCheckout({
      priceCents: reserved.amount,
      slotId: reserved.slotId,
      hours: reserved.hours,
      reservationId: reserved.id,
      expiresAt: reserved.expiresAt,
      productName: reserved.displayName,
    });
    await withTransaction(async (client) => {
      await client.query(`UPDATE reservations SET ls_checkout_url = $2 WHERE id = $1`, [
        reserved.id,
        checkoutUrl,
      ]);
    });
    return NextResponse.json({ checkoutUrl, ...shared });
  } catch (err) {
    console.error("checkout failed", err);
    await releaseReservation(reserved.id);
    return fail("Could not start checkout. Try again.", 502);
  }
}

/**
 * Records the hour a new listing asked for, or an entry upgrade. Checkout never locks an
 * hour: people who abandon an external payment page must not make the calendar look
 * unavailable. The first payment to arrive receives its requested open hour.
 */
async function reserve(
  claim: ClaimInput,
  displayName: string,
  pitch: string | null,
  imageUrl: string | null,
): Promise<Reserved> {
  if (claim.amountCents < MIN_ENTRY_CENTS) throw new Error("TOO_LITTLE");

  return withTransaction(async (client) => {
    await lockBoard(client);

    const now = new Date();
    const existing = await findExistingEntry(client, claim.url);

    if (existing) {
      if (claim.amountCents <= existing.amount_paid) throw new Error("NOT_AN_UPGRADE");

      const expiresAt = new Date(now.getTime() + config.reservationMinutes * 60_000);
      const chargeAmount = claim.amountCents - existing.amount_paid;
      const inserted = await client.query<{ id: string }>(
        `INSERT INTO reservations
           (amount, upgrade_amount, upgrade_entry_id, expires_at, display_name, url, pitch, image_url, twclid)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         RETURNING id::text AS id`,
        [
          chargeAmount,
          claim.amountCents,
          existing.id,
          expiresAt,
          displayName,
          claim.url,
          pitch,
          imageUrl,
          claim.twclid,
        ],
      );

      return {
        id: inserted.rows[0].id,
        slotId: null,
        startsAt: null,
        hours: 1,
        amount: chargeAmount,
        isUpgrade: true,
        displayName: existing.display_name ?? displayName,
        imageUrl,
        beyondHorizon: false,
        expiresAt,
      };
    }

    let slots: BlockSlot[];
    let beyondHorizon = false;

    if (claim.slotId) {
      const rows = await client.query<{ starts_at: Date; status: string }>(
        `SELECT id::text AS id, starts_at, status::text AS status FROM slots
          WHERE id = $1 FOR UPDATE`,
        [claim.slotId],
      );
      const row = rows.rows[0];
      if (!row) throw new Error("NOT_FOUND");
      if (new Date(row.starts_at).getTime() <= now.getTime()) throw new Error("STARTED");
      if (row.status !== "open") throw new Error("TAKEN");
      const requested = await getSlotBlock(client, new Date(row.starts_at), claim.hours, ["open"]);
      if (!requested) throw new Error("TAKEN");
      slots = requested;
    } else {
      slots = await findFirstOpenSlotBlock(client, claim.hours, now);
    }

    const slot = slots[0];
    const startsAt = new Date(slot.starts_at);
    const horizonEnd = Date.now() + config.calendarHours * HOUR_MS;
    beyondHorizon = slots[slots.length - 1].starts_at.getTime() > horizonEnd;

    // Never let a hold outlive the hour it is holding.
    const holdMs = Math.min(
      config.reservationMinutes * 60_000,
      Math.max(startsAt.getTime() - now.getTime(), 60_000),
    );
    const expiresAt = new Date(now.getTime() + holdMs);

    const inserted = await client.query<{ id: string }>(
      `INSERT INTO reservations
         (slot_id, hours, wall_amount, amount, expires_at, display_name, url, pitch, image_url, twclid)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       RETURNING id::text AS id`,
      [
        slot.id,
        claim.hours,
        claim.amountCents,
        claim.amountCents * claim.hours,
        expiresAt,
        displayName,
        claim.url,
        pitch,
        imageUrl,
        claim.twclid,
      ],
    );

    return {
      id: inserted.rows[0].id,
      slotId: slot.id,
      startsAt,
      hours: claim.hours,
      amount: claim.amountCents * claim.hours,
      isUpgrade: false,
      displayName,
      imageUrl,
      beyondHorizon,
      expiresAt,
    };
  });
}

type ExistingEntry = { id: string; amount_paid: number; display_name: string | null; url: string | null };

/** Must run under lockBoard: the amount used to calculate the checkout difference is live. */
async function findExistingEntry(
  client: PoolClient,
  rawUrl: string,
): Promise<ExistingEntry | null> {
  const domain = normalizeWallDomain(rawUrl);
  if (!domain) return null;
  const entries = await client.query<ExistingEntry>(
    `SELECT id::text AS id, amount_paid, display_name, url
       FROM wall_entries
      ORDER BY amount_paid DESC, created_at ASC, id ASC`,
  );
  return entries.rows.find((entry) => normalizeWallDomain(entry.url) === domain) ?? null;
}

async function releaseReservation(reservationId: string) {
  await withTransaction(async (client) => {
    await lockBoard(client);
    await client.query(`UPDATE reservations SET status = 'expired' WHERE id = $1`, [
      reservationId,
    ]);
  });
}
