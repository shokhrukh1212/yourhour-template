import { NextResponse } from "next/server";
import { isLemonSqueezyConfigured } from "@/lib/config";
import { query } from "@/lib/db";
import { applyPaidOrder } from "@/lib/sale";

export const dynamic = "force-dynamic";

/** Local payment completion; never reachable when production payments are configured. */
export async function GET(request: Request) {
  if (process.env.NODE_ENV === "production" || isLemonSqueezyConfigured()) {
    return NextResponse.json({ error: "not available" }, { status: 404 });
  }
  const intentId = new URL(request.url).searchParams.get("intent");
  if (!intentId || !/^[0-9a-f-]{36}$/i.test(intentId)) {
    return NextResponse.json({ error: "intent required" }, { status: 400 });
  }
  const rows = await query<{ expected_amount_cents: number }>(
    `SELECT expected_amount_cents FROM checkout_intents WHERE id = $1`,
    [intentId],
  );
  if (!rows[0]) return NextResponse.json({ error: "unknown intent" }, { status: 404 });

  const outcome = await applyPaidOrder({
    orderId: `dev-${intentId}`,
    intentId,
    providerSubtotalCents: rows[0].expected_amount_cents,
    providerTotalCents: rows[0].expected_amount_cents,
    providerCurrency: "USD",
    providerTestMode: true,
  });
  if (outcome.status === "applied" || outcome.status === "duplicate") {
    return NextResponse.redirect(new URL(`/?purchase=${intentId}`, request.url));
  }
  return NextResponse.json(outcome, { status: 409 });
}
