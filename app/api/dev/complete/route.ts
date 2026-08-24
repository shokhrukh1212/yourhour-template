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

  const rows = await query<{ amount: number | null; slot_id: string | null }>(
    `SELECT amount, slot_id::text AS slot_id FROM reservations WHERE id = $1`,
    [reservationId],
  );
  const reservation = rows[0];
  if (!reservation) {
    return NextResponse.json({ error: "unknown reservation" }, { status: 404 });
  }

  const outcome = await applyPaidOrder({
    orderId: `dev-${reservationId}`,
    reservationId,
    slotId: reservation.slot_id,
    // This is the total checkout charge; the stored per-hour bid sets Wall rank.
    pricePaid: reservation.amount ?? 0,
  });

  if (outcome.status === "applied" || outcome.status === "duplicate") {
    // Same landing as a real checkout, so the dev path exercises /success too.
    return NextResponse.redirect(new URL(`/success?r=${reservationId}`, request.url));
  }
  return NextResponse.json(outcome, { status: 409 });
}
