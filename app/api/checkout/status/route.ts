import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import { hashOwnerToken, ownerHashesMatch, ownerTokenFromRequest } from "@/lib/ownership";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const id = new URL(request.url).searchParams.get("r");
  if (!id || !/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.json({ error: "not found" }, { status: 404 });
  const rows = await query<{
    status: string; expected_amount_cents: number; target_bid_cents: number | null;
    owner_token_hash: string | null; campaign_id: string | null; product_name: string | null;
    bid_cents: number | null; rank: number | null;
    provider_total_cents: number | null; ls_order_id: string | null;
  }>(
    `SELECT i.status, i.expected_amount_cents, i.target_bid_cents, i.owner_token_hash,
            i.campaign_id::text, i.provider_total_cents, i.ls_order_id, c.product_name, c.bid_cents,
            CASE WHEN c.id IS NULL THEN NULL ELSE (
              SELECT count(*)::int + 1 FROM campaigns ahead
               WHERE ahead.bid_cents > c.bid_cents
                  OR (ahead.bid_cents = c.bid_cents AND (ahead.bid_placed_at, ahead.id) < (c.bid_placed_at, c.id))
            ) END AS rank
       FROM checkout_intents i LEFT JOIN campaigns c ON c.id = i.campaign_id
      WHERE i.id = $1`, [id],
  );
  const row = rows[0];
  const token = ownerTokenFromRequest(request);
  if (!row || !ownerHashesMatch(row.owner_token_hash, token ? hashOwnerToken(token) : null)) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  return NextResponse.json({
    ready: row.status === "completed" && Boolean(row.campaign_id), status: row.status,
    listingId: row.campaign_id, productName: row.product_name,
    targetBidCents: row.target_bid_cents, amountChargedCents: row.expected_amount_cents,
    bidCents: row.bid_cents, rank: row.rank,
    // Only set once the payment provider's webhook verified the charge. The browser
    // reports the Meta Purchase conversion from these two fields, so they must come
    // from what was actually paid -- never from what the buyer asked to pay.
    orderId: row.ls_order_id,
    amountPaidCents: row.provider_total_cents ?? (row.status === "completed" ? row.expected_amount_cents : null),
  }, { headers: { "cache-control": "no-store" } });
}
