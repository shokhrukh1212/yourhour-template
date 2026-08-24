import { NextResponse } from "next/server";
import type { PoolClient } from "pg";
import { config, isLemonSqueezyConfigured } from "@/lib/config";
import { lockBoard, withTransaction } from "@/lib/db";
import { createCheckout } from "@/lib/lemonsqueezy";
import { fetchUrlMetadata } from "@/lib/metadata";
import {
  hashOwnerToken,
  newOwnerToken,
  OWNER_COOKIE,
  ownerCookieOptions,
  ownerHashesMatch,
  ownerTokenFromRequest,
} from "@/lib/ownership";
import { hashIp } from "@/lib/click";
import { jumpPrice, priceForClicks } from "@/lib/pricing";
import { normalizeWallDomain } from "@/lib/wall-url";
import { type CheckoutInput, validateCheckout } from "@/lib/validate";

export const dynamic = "force-dynamic";

type ReservedIntent = {
  id: string;
  mode: "purchase" | "jump";
  priceCents: number;
  clicks: number;
  productName: string;
  campaignId: string | null;
  expiresAt: Date;
};

function fail(error: string, status = 400) {
  return NextResponse.json({ error }, { status });
}

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return fail("Invalid request.");
  }
  const parsed = validateCheckout(body);
  if (!parsed.ok) return fail(parsed.error);

  const currentToken = ownerTokenFromRequest(request);
  const ownerToken = currentToken ?? newOwnerToken();
  const ownerHash = hashOwnerToken(ownerToken);

  let metadata: Awaited<ReturnType<typeof fetchUrlMetadata>> | null = null;
  if (parsed.value.mode === "purchase") {
    // Keep an external scrape outside the serialized transaction.
    metadata = await fetchUrlMetadata(parsed.value.url);
  }

  let reserved: ReservedIntent;
  try {
    reserved = await reserveIntent(parsed.value, metadata, ownerHash, hashIp(request));
  } catch (error) {
    const code = error instanceof Error ? error.message : "";
    if (code === "SOLD_OUT") {
      return fail("Sold out for now — the queue is full. Check back soon.", 409);
    }
    if (code === "NOT_OWNER") {
      return fail("This product already has a private owner. Open its receipt on the original device to make changes.", 403);
    }
    if (code === "NAME_TAKEN") return fail("Someone is already listed as that product.", 409);
    if (code === "NOT_FOUND") return fail("Campaign not found.", 404);
    if (code === "NOT_QUEUED") return fail("Only a queued campaign can move to the front.", 409);
    if (code === "JUMP_PENDING") return fail("Another queue move is being paid for. Try again in a few minutes.", 409);
    console.error("checkout intent failed", error);
    return fail("Could not prepare checkout. Try again.", 500);
  }

  let checkoutUrl: string;
  if (!isLemonSqueezyConfigured()) {
    if (process.env.NODE_ENV === "production") return fail("Payments are not configured.", 503);
    checkoutUrl = `/api/dev/complete?intent=${reserved.id}`;
  } else {
    try {
      checkoutUrl = await createCheckout({
        priceCents: reserved.priceCents,
        intentId: reserved.id,
        expiresAt: reserved.expiresAt,
        productName: reserved.productName,
        mode: reserved.mode,
        clicks: reserved.clicks,
      });
    } catch (error) {
      console.error("checkout failed", error);
      await withTransaction((client) =>
        client.query(`UPDATE checkout_intents SET status = 'expired' WHERE id = $1`, [reserved.id]).then(() => undefined),
      );
      return fail("Could not start checkout. Try again.", 502);
    }
  }

  await withTransaction((client) =>
    client.query(`UPDATE checkout_intents SET ls_checkout_url = $2 WHERE id = $1`, [reserved.id, checkoutUrl]).then(() => undefined),
  );
  const response = NextResponse.json({
    checkoutUrl,
    devMode: !isLemonSqueezyConfigured(),
    intentId: reserved.id,
    campaignId: reserved.campaignId,
    priceCents: reserved.priceCents,
  });
  if (!currentToken) response.cookies.set(OWNER_COOKIE, ownerToken, ownerCookieOptions);
  return response;
}

async function reserveIntent(
  input: CheckoutInput,
  metadata: Awaited<ReturnType<typeof fetchUrlMetadata>> | null,
  ownerHash: string,
  purchaseIpHash: string,
): Promise<ReservedIntent> {
  return withTransaction(async (client) => {
    await lockBoard(client);
    await client.query(
      `UPDATE checkout_intents SET status = 'expired'
        WHERE status = 'pending' AND expires_at <= now()`,
    );

    if (input.mode === "purchase") {
      if (!metadata) throw new Error("INVALID_METADATA");
      return reservePurchase(client, input, metadata, ownerHash, purchaseIpHash);
    }

    const rows = await client.query<{
      id: string;
      product_name: string;
      owner_token_hash: string | null;
      status: string;
    }>(
      `SELECT id::text AS id, product_name, owner_token_hash,
              status::text AS status
         FROM campaigns WHERE id = $1 FOR UPDATE`,
      [input.campaignId],
    );
    const campaign = rows.rows[0];
    if (!campaign) throw new Error("NOT_FOUND");
    if (!ownerHashesMatch(campaign.owner_token_hash, ownerHash)) throw new Error("NOT_OWNER");

    const expiresAt = new Date(Date.now() + config.reservationMinutes * 60_000);
    if (campaign.status !== "queued") throw new Error("NOT_QUEUED");
    const pending = await client.query(
      `SELECT 1 FROM checkout_intents
        WHERE mode = 'jump' AND status = 'pending' AND expires_at > now() LIMIT 1`,
    );
    if (pending.rows[0]) throw new Error("JUMP_PENDING");
    const top = await client.query<{ highest: number }>(
      `SELECT COALESCE(max(priority_cents), 0)::int AS highest
         FROM campaigns WHERE status = 'queued'`,
    );
    const priceCents = jumpPrice(top.rows[0]?.highest ?? 0);
    const inserted = await client.query<{ id: string }>(
      `INSERT INTO checkout_intents
         (mode, campaign_id, expected_amount_cents, target_priority_cents,
          owner_token_hash, expires_at)
       VALUES ('jump', $1, $2, $2, $3, $4)
       RETURNING id::text AS id`,
      [campaign.id, priceCents, ownerHash, expiresAt],
    );
    return {
      id: inserted.rows[0].id,
      mode: "jump",
      priceCents,
      clicks: 0,
      productName: campaign.product_name,
      campaignId: campaign.id,
      expiresAt,
    };
  });
}

async function reservePurchase(
  client: PoolClient,
  input: Extract<CheckoutInput, { mode: "purchase" }>,
  metadata: Awaited<ReturnType<typeof fetchUrlMetadata>>,
  ownerHash: string,
  purchaseIpHash: string,
): Promise<ReservedIntent> {
  const all = await client.query<{
    id: string;
    url: string;
    product_name: string;
    owner_token_hash: string | null;
    amount_paid_cents: number;
  }>(
    `SELECT id::text AS id, url, product_name, owner_token_hash, amount_paid_cents
       FROM campaigns FOR UPDATE`,
  );
  const domain = normalizeWallDomain(input.url);
  const existing = all.rows.find((row) => normalizeWallDomain(row.url) === domain) ?? null;
  if (existing && !ownerHashesMatch(existing.owner_token_hash, ownerHash)) {
    throw new Error("NOT_OWNER");
  }

  const displayName = (metadata.scraped ? metadata.productName : input.name ?? metadata.productName).trim();
  const pitch = metadata.scraped ? metadata.pitch : input.pitch ?? metadata.pitch;
  if (!existing && all.rows.some((row) => row.product_name.toLowerCase() === displayName.toLowerCase())) {
    throw new Error("NAME_TAKEN");
  }

  const capacity = await client.query<{ max_clicks: number; outstanding: string; held: string }>(
    `SELECT sc.max_outstanding_clicks AS max_clicks,
            COALESCE((SELECT sum(clicks_purchased - (clicks_delivered - bonus_clicks) - clicks_refunded)
                        FROM campaigns WHERE status IN ('queued','live')), 0)::text AS outstanding,
            COALESCE((SELECT sum(clicks_delta) FROM checkout_intents
                        WHERE mode = 'purchase' AND status = 'pending' AND expires_at > now()), 0)::text AS held
       FROM site_config sc WHERE singleton = true`,
  );
  const supply = capacity.rows[0];
  if (!supply || Number(supply.outstanding) + Number(supply.held) + input.clicks > supply.max_clicks) {
    throw new Error("SOLD_OUT");
  }

  const packagePrice = priceForClicks(input.clicks);
  const priceCents = packagePrice;
  const expiresAt = new Date(Date.now() + config.reservationMinutes * 60_000);
  const inserted = await client.query<{ id: string }>(
    `INSERT INTO checkout_intents
       (mode, campaign_id, clicks_delta, expected_amount_cents,
        display_name, url, pitch, icon_url, owner_token_hash, purchase_ip_hash,
        twclid, expires_at)
     VALUES ('purchase', $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
     RETURNING id::text AS id`,
    [
      existing?.id ?? null,
      input.clicks,
      priceCents,
      existing?.product_name ?? displayName,
      input.url,
      pitch,
      metadata.imageUrl,
      ownerHash,
      purchaseIpHash,
      input.twclid,
      expiresAt,
    ],
  );
  return {
    id: inserted.rows[0].id,
    mode: "purchase",
    priceCents,
    clicks: input.clicks,
    productName: existing?.product_name ?? displayName,
    campaignId: existing?.id ?? null,
    expiresAt,
  };
}
