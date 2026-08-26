import { NextResponse } from "next/server";
import type { PoolClient } from "pg";
import { dispatchVemetricEvent, insertFunnelEvent } from "@/lib/analytics";
import { hashIp } from "@/lib/click";
import { config, isLemonSqueezyConfigured } from "@/lib/config";
import { lockBoard, withTransaction } from "@/lib/db";
import { createCheckout } from "@/lib/lemonsqueezy";
import { fetchUrlMetadata } from "@/lib/metadata";
import { hashOwnerToken, newOwnerToken, OWNER_COOKIE, ownerCookieOptions, ownerHashesMatch, ownerTokenFromRequest } from "@/lib/ownership";
import { amountDueCents } from "@/lib/pricing";
import { requestAnalyticsContext } from "@/lib/request-context";
import { validateBidCheckout, type BidCheckoutInput } from "@/lib/validate";
import { ensureVisitorId, VISITOR_COOKIE, visitorCookieOptions } from "@/lib/visitor-id";
import { normalizeWallDomain } from "@/lib/wall-url";

export const dynamic = "force-dynamic";

type ReservedBid = {
  id: string;
  priceCents: number;
  productName: string;
  campaignId: string | null;
  expiresAt: Date;
  projectedRank: number;
  checkoutUrl: string | null;
};

function fail(error: string, status = 400) { return NextResponse.json({ error }, { status }); }

export async function POST(request: Request) {
  let body: unknown;
  try { body = await request.json(); } catch { return fail("Invalid request."); }
  const parsed = validateBidCheckout(body);
  if (!parsed.ok) return fail(parsed.error);

  const currentToken = ownerTokenFromRequest(request);
  const ownerToken = currentToken ?? newOwnerToken();
  const ownerHash = hashOwnerToken(ownerToken);
  const visitor = ensureVisitorId(request);
  const metadata = await fetchUrlMetadata(parsed.value.url);

  let reserved: ReservedBid;
  try {
    reserved = await reserveBid(parsed.value, metadata, ownerHash, hashIp(request), visitor.id, requestAnalyticsContext(request));
  } catch (error) {
    const code = error instanceof Error ? error.message : "";
    if (code === "NOT_OWNER") return fail("This product already has an owner. Use the original browser or contact support with your Lemon Squeezy receipt.", 403);
    if (code === "BID_TOO_LOW") return fail("That bid no longer beats the product you selected. Refresh and try again.", 409);
    if (code === "BID_PENDING") return fail("A checkout for this product is already pending. Try again after it expires.", 409);
    if (code === "NAME_REQUIRED") return fail("Enter a product name so we can create the listing.");
    console.error("bid checkout intent failed", error);
    return fail("Could not prepare checkout. Try again.", 500);
  }

  let checkoutUrl = reserved.checkoutUrl;
  if (checkoutUrl) {
    // The same owner returned from Lemon Squeezy and submitted the unchanged bid.
    // Reusing its still-valid checkout avoids both duplicate intents and a dead end.
  } else if (!isLemonSqueezyConfigured()) {
    if (process.env.NODE_ENV === "production") return fail("Payments are not configured.", 503);
    checkoutUrl = `/api/dev/complete?intent=${reserved.id}`;
  } else {
    try {
      checkoutUrl = await createCheckout({ priceCents: reserved.priceCents, intentId: reserved.id, expiresAt: reserved.expiresAt, productName: reserved.productName, mode: "bid" });
    } catch (error) {
      console.error("checkout failed", error);
      await withTransaction((client) => client.query(`UPDATE checkout_intents SET status = 'expired' WHERE id = $1`, [reserved.id]).then(() => undefined));
      return fail("Could not start checkout. Try again.", 502);
    }
  }

  const inserted = await withTransaction(async (client) => {
    await client.query(`UPDATE checkout_intents SET ls_checkout_url = $2 WHERE id = $1`, [reserved.id, checkoutUrl]);
    return insertFunnelEvent(client, {
      name: "checkout_started", idempotencyKey: reserved.id, visitorId: visitor.id,
      checkoutIntentId: reserved.id, campaignId: reserved.campaignId,
      eventData: { mode: "bid", targetBidCents: parsed.value.targetBidCents, priceCents: reserved.priceCents, currency: "USD", ...parsed.value.attribution },
    });
  });
  if (inserted) void dispatchVemetricEvent("checkout_started", reserved.id);
  const response = NextResponse.json({ checkoutUrl, intentId: reserved.id, campaignId: reserved.campaignId, amountDueCents: reserved.priceCents, projectedRank: reserved.projectedRank, reusedCheckout: Boolean(reserved.checkoutUrl) });
  if (!currentToken) response.cookies.set(OWNER_COOKIE, ownerToken, ownerCookieOptions);
  if (visitor.isNew) response.cookies.set(VISITOR_COOKIE, visitor.id, visitorCookieOptions);
  return response;
}

async function reserveBid(
  input: BidCheckoutInput,
  metadata: Awaited<ReturnType<typeof fetchUrlMetadata>>,
  ownerHash: string,
  purchaseIpHash: string,
  visitorId: string,
  requestContext: Record<string, unknown>,
): Promise<ReservedBid> {
  return withTransaction(async (client) => {
    await lockBoard(client);
    await client.query(`UPDATE checkout_intents SET status = 'expired' WHERE status = 'pending' AND expires_at <= now()`);
    const domain = normalizeWallDomain(input.url);
    if (!domain) throw new Error("INVALID_URL");
    const selected = await client.query<{ id: string; bid_cents: number; product_name: string; owner_token_hash: string | null }>(
      `SELECT id::text, bid_cents, product_name, owner_token_hash FROM campaigns WHERE normalized_domain = $1 FOR UPDATE`, [domain],
    );
    const existing = selected.rows[0] ?? null;
    if (existing?.owner_token_hash && !ownerHashesMatch(existing.owner_token_hash, ownerHash)) throw new Error("NOT_OWNER");
    if (existing && input.targetBidCents <= existing.bid_cents) throw new Error("BID_TOO_LOW");
    const pending = await client.query<{
      id: string;
      campaign_id: string | null;
      expected_amount_cents: number;
      target_bid_cents: number | null;
      display_name: string | null;
      owner_token_hash: string | null;
      expires_at: Date;
      ls_checkout_url: string | null;
    }>(
      `SELECT id::text, campaign_id::text, expected_amount_cents, target_bid_cents,
              display_name, owner_token_hash, expires_at, ls_checkout_url
         FROM checkout_intents
        WHERE normalized_domain = $1 AND mode = 'bid' AND status = 'pending'
          AND expires_at > now()
        LIMIT 1 FOR UPDATE`,
      [domain],
    );
    const pendingIntent = pending.rows[0] ?? null;
    if (pendingIntent) {
      const reusable = ownerHashesMatch(pendingIntent.owner_token_hash, ownerHash)
        && pendingIntent.target_bid_cents === input.targetBidCents
        && Boolean(pendingIntent.ls_checkout_url);
      if (!reusable) throw new Error("BID_PENDING");
      const rank = await projectedRank(client, input.targetBidCents, pendingIntent.campaign_id);
      return {
        id: pendingIntent.id,
        priceCents: pendingIntent.expected_amount_cents,
        productName: pendingIntent.display_name ?? metadata.productName,
        campaignId: pendingIntent.campaign_id,
        expiresAt: pendingIntent.expires_at,
        projectedRank: rank,
        checkoutUrl: pendingIntent.ls_checkout_url,
      };
    }

    const productName = (existing?.product_name ?? metadata.productName).trim();
    if (!productName) throw new Error("NAME_REQUIRED");
    const pitch = metadata.pitch;
    const priceCents = amountDueCents(existing?.bid_cents ?? null, input.targetBidCents);
    if (priceCents <= 0) throw new Error("BID_TOO_LOW");
    const rank = await projectedRank(client, input.targetBidCents, existing?.id ?? null);
    const expiresAt = new Date(Date.now() + config.reservationMinutes * 60_000);
    const inserted = await client.query<{ id: string }>(
      `INSERT INTO checkout_intents
         (mode, campaign_id, expected_amount_cents, target_bid_cents, normalized_domain,
          display_name, url, pitch, icon_url, owner_token_hash, purchase_ip_hash,
          visitor_id, twclid, attribution, expires_at)
       VALUES ('bid',$1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::uuid,$12,$13::jsonb,$14)
       RETURNING id::text`,
      [existing?.id ?? null, priceCents, input.targetBidCents, domain, productName, input.url, pitch, metadata.imageUrl, ownerHash, purchaseIpHash, visitorId, input.twclid, JSON.stringify({ ...input.attribution, ...requestContext }), expiresAt],
    );
    return { id: inserted.rows[0].id, priceCents, productName, campaignId: existing?.id ?? null, expiresAt, projectedRank: rank, checkoutUrl: null };
  });
}

async function projectedRank(client: PoolClient, targetBidCents: number, existingId: string | null): Promise<number> {
  const rows = await client.query<{ rank: number }>(
    `SELECT count(*)::int + 1 AS rank FROM campaigns WHERE id <> COALESCE($2::bigint, -1) AND bid_cents >= $1`,
    [targetBidCents, existingId],
  );
  return rows.rows[0]?.rank ?? 1;
}
