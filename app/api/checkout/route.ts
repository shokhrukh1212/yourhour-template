import { NextResponse } from "next/server";
import { config, isLemonSqueezyConfigured } from "@/lib/config";
import { lockBoard, withTransaction } from "@/lib/db";
import { createCheckout } from "@/lib/lemonsqueezy";
import { fetchUrlMetadata } from "@/lib/metadata";
import { MIN_ENTRY_CENTS } from "@/lib/pricing";
import { reconcileBoard } from "@/lib/reconcile";
import { HOUR_MS } from "@/lib/time";
import { type ClaimInput, validateClaim } from "@/lib/validate";
import { wallNameIsTaken } from "@/lib/wall";

export const dynamic = "force-dynamic";

function fail(error: string, status = 400) {
  return NextResponse.json({ error }, { status });
}

type Reserved = {
  id: string;
  slotId: string;
  startsAt: Date;
  amount: number;
  displayName: string;
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

  // Re-checked here and not only in /api/preview: the preview is advisory, and two
  // buyers racing on the same name must not both get through.
  if (await wallNameIsTaken(displayName)) {
    return fail("Someone is already on the Wall as that product.", 409);
  }

  let reserved: Reserved;
  try {
    reserved = await reserve(claim, displayName, pitch);
  } catch (err) {
    const message = err instanceof Error ? err.message : "";
    if (message === "TAKEN") return fail("That hour has just been taken.", 409);
    if (message === "STARTED") return fail("That hour has already started.", 409);
    if (message === "NOT_FOUND") return fail("That hour is not on the board.", 404);
    if (message === "TOO_LITTLE") return fail("The minimum is $3.", 409);
    console.error("reservation failed", err);
    return fail("Could not hold that hour. Try again.", 500);
  }

  const shared = {
    slotId: reserved.slotId,
    startsAtIso: reserved.startsAt.toISOString(),
    beyondHorizon: reserved.beyondHorizon,
    displayName: reserved.displayName,
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
 * Holds one hour for the length of the checkout, so the hour quoted before payment is
 * the hour delivered after it. It holds no price: the price is derived from the Wall and
 * only ever rises, so there is nothing that could move under the buyer.
 */
async function reserve(
  claim: ClaimInput,
  displayName: string,
  pitch: string | null,
): Promise<Reserved> {
  if (claim.amountCents < MIN_ENTRY_CENTS) throw new Error("TOO_LITTLE");

  return withTransaction(async (client) => {
    await lockBoard(client);

    const now = new Date();
    let slot: { id: string; starts_at: Date };
    let beyondHorizon = false;

    if (claim.slotId) {
      const rows = await client.query<{ id: string; starts_at: Date; status: string }>(
        `SELECT id::text AS id, starts_at, status::text AS status FROM slots
          WHERE id = $1 FOR UPDATE`,
        [claim.slotId],
      );
      const row = rows.rows[0];
      if (!row) throw new Error("NOT_FOUND");
      if (new Date(row.starts_at).getTime() <= now.getTime()) throw new Error("STARTED");
      if (row.status !== "open") throw new Error("TAKEN");
      slot = row;
    } else {
      const earliest = await client.query<{ id: string; starts_at: Date }>(
        `SELECT id::text AS id, starts_at FROM slots
          WHERE status = 'open' AND starts_at > now()
          ORDER BY starts_at ASC LIMIT 1 FOR UPDATE`,
      );
      if (earliest.rows[0]) {
        slot = earliest.rows[0];
      } else {
        // Every hour on the 24-hour calendar is taken. Create the next one past the end
        // of it rather than refusing the sale. ON CONFLICT keeps this safe against
        // backfillOpenSlots creating the same row.
        const created = await client.query<{ id: string; starts_at: Date }>(
          `INSERT INTO slots (starts_at)
           SELECT GREATEST(
                    COALESCE((SELECT max(starts_at) FROM slots), date_trunc('hour', now())),
                    date_trunc('hour', now())
                  ) + interval '1 hour'
           ON CONFLICT (starts_at) DO UPDATE SET starts_at = EXCLUDED.starts_at
           RETURNING id::text AS id, starts_at`,
        );
        slot = created.rows[0];
      }
    }

    const startsAt = new Date(slot.starts_at);
    const horizonEnd = Date.now() + config.calendarHours * HOUR_MS;
    beyondHorizon = startsAt.getTime() > horizonEnd;

    // Never let a hold outlive the hour it is holding.
    const holdMs = Math.min(
      config.reservationMinutes * 60_000,
      Math.max(startsAt.getTime() - now.getTime(), 60_000),
    );
    const expiresAt = new Date(now.getTime() + holdMs);

    const inserted = await client.query<{ id: string }>(
      `INSERT INTO reservations (slot_id, amount, expires_at, display_name, url, pitch)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id::text AS id`,
      [slot.id, claim.amountCents, expiresAt, displayName, claim.url, pitch],
    );

    await client.query(`UPDATE slots SET status = 'reserved' WHERE id = $1`, [slot.id]);

    return {
      id: inserted.rows[0].id,
      slotId: slot.id,
      startsAt,
      amount: claim.amountCents,
      displayName,
      beyondHorizon,
      expiresAt,
    };
  });
}

async function releaseReservation(reservationId: string) {
  await withTransaction(async (client) => {
    await lockBoard(client);
    await client.query(
      `UPDATE slots SET status = 'open'
        WHERE id IN (SELECT slot_id FROM reservations WHERE id = $1)
          AND status = 'reserved'`,
      [reservationId],
    );
    await client.query(`UPDATE reservations SET status = 'expired' WHERE id = $1`, [
      reservationId,
    ]);
  });
}
