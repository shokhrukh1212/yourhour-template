import { NextResponse } from "next/server";
import { isLemonSqueezyConfigured } from "@/lib/config";
import { query } from "@/lib/db";
import { applyPaidSponsorshipOrder } from "@/lib/sponsorship-sale";

export const dynamic = "force-dynamic";

/** Local-only provider webhook stand-in for testing the complete sponsor flow. */
export async function GET(request: Request) {
  if (process.env.NODE_ENV === "production" || isLemonSqueezyConfigured()) {
    return NextResponse.json({ error: "not available" }, { status: 404 });
  }
  const id = new URL(request.url).searchParams.get("id");
  if (!id || !/^[0-9a-f-]{36}$/i.test(id)) {
    return NextResponse.json({ error: "sponsorship required" }, { status: 400 });
  }
  const rows = await query<{ amount_paid_cents: number; currency: string }>(
    `SELECT amount_paid_cents, currency FROM sponsorships WHERE id = $1`,
    [id],
  );
  if (!rows[0]) return NextResponse.json({ error: "not found" }, { status: 404 });
  await applyPaidSponsorshipOrder({
    sponsorshipId: id,
    orderId: `dev-sponsor-${id}`,
    providerSubtotalCents: rows[0].amount_paid_cents,
    providerTotalCents: rows[0].amount_paid_cents,
    providerCurrency: rows[0].currency,
  });
  return NextResponse.redirect(new URL(`/?sponsorship=${id}`, request.url));
}
