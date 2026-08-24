import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import { estimateQueue, getQueueWithLive, getRollingClicksPerHour, formatEta } from "@/lib/campaigns";
import { hashOwnerToken, ownerHashesMatch, ownerTokenFromRequest } from "@/lib/ownership";
import { jumpPrice } from "@/lib/pricing";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const id = new URL(request.url).searchParams.get("r");
  if (!id || !/^[0-9a-f-]{36}$/i.test(id)) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  const rows = await query<{
    status: string;
    mode: string;
    clicks_delta: number;
    expected_amount_cents: number;
    owner_token_hash: string | null;
    campaign_id: string | null;
    slug: string | null;
    product_name: string | null;
    campaign_status: string | null;
  }>(
    `SELECT i.status, i.mode, i.clicks_delta, i.expected_amount_cents,
            i.owner_token_hash, i.campaign_id::text AS campaign_id,
            c.slug, c.product_name, c.status::text AS campaign_status
       FROM checkout_intents i
       LEFT JOIN campaigns c ON c.id = i.campaign_id
      WHERE i.id = $1`,
    [id],
  );
  const row = rows[0];
  if (!row) return NextResponse.json({ error: "not found" }, { status: 404 });

  const token = ownerTokenFromRequest(request);
  const suppliedHash = token ? hashOwnerToken(token) : null;
  if (!ownerHashesMatch(row.owner_token_hash, suppliedHash)) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  let queuePosition: number | null = null;
  let startsIn: string | null = null;
  let nextJumpPriceCents: number | null = null;
  if (row.campaign_id && row.campaign_status && row.campaign_status !== "delivered") {
    const [queue, rate] = await Promise.all([getQueueWithLive(), getRollingClicksPerHour()]);
    const position = queue.findIndex((campaign) => campaign.id === row.campaign_id);
    if (position >= 0) {
      queuePosition = position + 1;
      startsIn = position === 0 ? "now" : formatEta(estimateQueue(queue, rate)[row.campaign_id]?.start ?? null, "about ");
    }
    if (row.campaign_status === "queued") {
      const highest = Math.max(0, ...queue.filter((campaign) => campaign.status === "queued").map((campaign) => campaign.priority_cents));
      nextJumpPriceCents = jumpPrice(highest);
    }
  }

  return NextResponse.json(
    {
      ready: Boolean(row.slug),
      status: row.status,
      mode: row.mode,
      slug: row.slug,
      productName: row.product_name,
      clicks: row.clicks_delta,
      priceCents: row.expected_amount_cents,
      queuePosition,
      startsIn,
      jumpPriceCents: nextJumpPriceCents,
      campaignId: row.campaign_id,
    },
    { headers: { "cache-control": "no-store" } },
  );
}
