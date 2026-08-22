import { NextResponse } from "next/server";
import { isLemonSqueezyConfigured } from "@/lib/config";
import { query } from "@/lib/db";
import { applyPaidOrder } from "@/lib/sale";

export const dynamic = "force-dynamic";

/**
 * Simulates a completed Lemon Squeezy purchase so the full flow can be exercised locally
 * before payment credentials exist. Hard-disabled in production and whenever real
 * Lemon Squeezy credentials are present.
 */
export async function GET(request: Request) {
  if (process.env.NODE_ENV === "production" || isLemonSqueezyConfigured()) {
    return NextResponse.json({ error: "not available" }, { status: 404 });
  }

  const reservationId = new URL(request.url).searchParams.get("reservation");
  if (!reservationId) {
    return NextResponse.json({ error: "reservation required" }, { status: 400 });
  }

  const rows = await query<{
    kind: string;
    buyer_email: string | null;
    locked_price: number;
    amount: number | null;
    slot_id: string | null;
  }>(
    `SELECT kind, buyer_email, locked_price, amount, slot_id::text AS slot_id
       FROM reservations WHERE id = $1`,
    [reservationId],
  );
  const reservation = rows[0];
  if (!reservation) {
    return NextResponse.json({ error: "unknown reservation" }, { status: 404 });
  }

  const outcome = await applyPaidOrder({
    kind: reservation.kind === "wall" ? "wall" : "hour",
    orderId: `dev-${reservationId}`,
    reservationId,
    slotId: reservation.slot_id,
    // The buyer's chosen amount, not the minimum -- that is what ranks them on the Wall.
    pricePaid: reservation.amount ?? reservation.locked_price,
    email: reservation.buyer_email,
  });

  if (outcome.status === "applied") {
    return NextResponse.redirect(new URL(`/u/${outcome.slug}?welcome=1`, request.url));
  }
  if (outcome.status === "duplicate" && outcome.slug) {
    return NextResponse.redirect(new URL(`/u/${outcome.slug}?welcome=1`, request.url));
  }
  return NextResponse.json(outcome, { status: 409 });
}
