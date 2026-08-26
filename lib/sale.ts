import type { PoolClient } from "pg";
import { dispatchVemetricEvent, dispatchXPurchase, insertFunnelEvent } from "./analytics";
import { config } from "./config";
import { lockBoard, withTransaction } from "./db";
import { firstFreeSlug, slugify } from "./slug";

export type PaidOrderInput = {
  intentId: string | null;
  orderId: string;
  providerSubtotalCents: number;
  providerTotalCents: number;
  providerCurrency: string;
  providerTestMode: boolean;
};

export type PaidOrderOutcome = {
  status: "applied" | "duplicate";
  campaignId: string;
  slug: string;
  mode: "bid";
  rank: number;
};

type BidIntent = {
  id: string;
  campaign_id: string | null;
  expected_amount_cents: number;
  target_bid_cents: number;
  display_name: string | null;
  url: string | null;
  normalized_domain: string | null;
  pitch: string | null;
  icon_url: string | null;
  owner_token_hash: string | null;
  visitor_id: string | null;
  twclid: string | null;
  attribution: Record<string, unknown>;
  ls_order_id: string | null;
  status: string;
};

export function paidOrderValidationError(
  expectedAmountCents: number,
  input: Pick<PaidOrderInput, "providerSubtotalCents" | "providerTotalCents" | "providerCurrency">,
): string | null {
  if (input.providerCurrency.toUpperCase() !== "USD") return "INVALID_CURRENCY";
  if (input.providerSubtotalCents !== expectedAmountCents) return "PAYMENT_AMOUNT_MISMATCH";
  if (input.providerTotalCents < input.providerSubtotalCents) return "PAYMENT_TOO_SMALL";
  return null;
}

/** Applies a provider-verified bid once. Ranking is decided when payment completes. */
export async function applyPaidOrder(input: PaidOrderInput): Promise<PaidOrderOutcome> {
  const result = await withTransaction(async (client) => {
    await lockBoard(client);
    const duplicate = await client.query<{ campaign_id: string; slug: string; rank: number }>(
      `SELECT i.campaign_id::text AS campaign_id, c.slug,
              (SELECT count(*)::int + 1 FROM campaigns ahead
                WHERE ahead.bid_cents > c.bid_cents
                   OR (ahead.bid_cents = c.bid_cents AND (ahead.bid_placed_at, ahead.id) < (c.bid_placed_at, c.id))) AS rank
         FROM checkout_intents i JOIN campaigns c ON c.id = i.campaign_id
        WHERE i.ls_order_id = $1 AND i.status = 'completed' LIMIT 1`,
      [input.orderId],
    );
    if (duplicate.rows[0]) {
      return { status: "duplicate" as const, campaignId: duplicate.rows[0].campaign_id, slug: duplicate.rows[0].slug, mode: "bid" as const, rank: duplicate.rows[0].rank, analytics: null };
    }

    if (!input.intentId) throw new Error("MISSING_INTENT");
    const selected = await client.query<BidIntent>(
      `SELECT id::text, campaign_id::text, expected_amount_cents, target_bid_cents,
              display_name, url, normalized_domain, pitch, icon_url, owner_token_hash,
              visitor_id::text, twclid, attribution, ls_order_id, status
         FROM checkout_intents WHERE id = $1 FOR UPDATE`,
      [input.intentId],
    );
    const intent = selected.rows[0];
    if (!intent) throw new Error("INTENT_NOT_FOUND");
    if (intent.status === "completed") {
      if (intent.ls_order_id !== input.orderId) throw new Error("INTENT_ALREADY_COMPLETED");
      return completedOutcome(client, intent.campaign_id, "duplicate", null);
    }
    if (intent.status !== "pending" && intent.status !== "expired") throw new Error("INTENT_INVALID");
    if (!intent.target_bid_cents || !intent.url || !intent.normalized_domain || !intent.display_name) throw new Error("INVALID_BID");
    const paymentError = paidOrderValidationError(intent.expected_amount_cents, input);
    if (paymentError) throw new Error(paymentError);

    let existingId = intent.campaign_id;
    if (!existingId) {
      const appeared = await client.query<{ id: string }>(
        `SELECT id::text FROM campaigns WHERE normalized_domain = $1 FOR UPDATE`,
        [intent.normalized_domain],
      );
      existingId = appeared.rows[0]?.id ?? null;
    }
    const campaignId = existingId
      ? await updateListing(client, intent, existingId)
      : await createListing(client, intent);
    await client.query(
      `UPDATE checkout_intents
          SET campaign_id = $2, status = 'completed', completed_at = now(),
              ls_order_id = $3, provider_subtotal_cents = $4,
              provider_total_cents = $5, provider_currency = $6, provider_test_mode = $7
        WHERE id = $1`,
      [intent.id, campaignId, input.orderId, input.providerSubtotalCents, input.providerTotalCents, input.providerCurrency.toUpperCase(), input.providerTestMode],
    );
    await insertFunnelEvent(client, {
      name: "purchase_completed", idempotencyKey: input.orderId, visitorId: intent.visitor_id,
      campaignId, checkoutIntentId: intent.id, orderId: input.orderId,
      eventData: {
        mode: "bid", targetBidCents: intent.target_bid_cents, priceCents: intent.expected_amount_cents,
        providerTotalCents: input.providerTotalCents, currency: input.providerCurrency.toUpperCase(),
        testMode: input.providerTestMode, twclid: intent.twclid,
        eventSourceUrl: `${config.siteUrl}/?purchase=${intent.id}`, ...intent.attribution,
      },
    });
    return completedOutcome(client, campaignId, "applied", input.orderId);
  });

  if (result.analytics) {
    void dispatchVemetricEvent("purchase_completed", result.analytics);
    void dispatchXPurchase(result.analytics);
  }
  return { status: result.status, campaignId: result.campaignId, slug: result.slug, mode: result.mode, rank: result.rank };
}

async function updateListing(client: PoolClient, intent: BidIntent, campaignId: string): Promise<string> {
  const updated = await client.query<{ id: string }>(
    `UPDATE campaigns
        SET bid_cents = GREATEST($2, bid_cents + $9),
            amount_paid_cents = GREATEST($2, bid_cents + $9), bid_placed_at = now(),
            owner_token_hash = COALESCE(owner_token_hash, $3), url = $4, normalized_domain = $5,
            product_name = COALESCE(NULLIF($6, ''), product_name),
            pitch = COALESCE($7, pitch), icon_url = COALESCE($8, icon_url)
      WHERE id = $1 RETURNING id::text`,
    [campaignId, intent.target_bid_cents, intent.owner_token_hash, intent.url, intent.normalized_domain, intent.display_name, intent.pitch, intent.icon_url, intent.expected_amount_cents],
  );
  if (!updated.rows[0]) throw new Error("STALE_BID");
  return updated.rows[0].id;
}

async function createListing(client: PoolClient, intent: BidIntent): Promise<string> {
  const exists = await client.query(`SELECT 1 FROM campaigns WHERE normalized_domain = $1 LIMIT 1`, [intent.normalized_domain]);
  if (exists.rows[0]) throw new Error("DOMAIN_ALREADY_LISTED");
  const slug = await assignSlug(client, intent.display_name ?? "product");
  const inserted = await client.query<{ id: string }>(
    `INSERT INTO campaigns
       (slug, url, normalized_domain, product_name, pitch, icon_url,
        clicks_purchased, clicks_delivered, bonus_clicks, accounting_status,
        purchased_clicks, guaranteed_clicks_delivered, bonus_clicks_delivered,
        historical_clicks_delivered, amount_paid_cents, bid_cents, verified_clicks,
        bid_placed_at, owner_token_hash, status, started_at, delivered_at)
     VALUES ($1,$2,$3,$4,$5,$6,0,0,0,'verified',0,0,0,0,$7,$7,0,now(),$8,'delivered',now(),now())
     RETURNING id::text`,
    [slug, intent.url, intent.normalized_domain, intent.display_name, intent.pitch, intent.icon_url, intent.target_bid_cents, intent.owner_token_hash],
  );
  return inserted.rows[0].id;
}

async function assignSlug(client: PoolClient, name: string): Promise<string> {
  const base = slugify(name);
  const rows = await client.query<{ slug: string }>(`SELECT slug FROM campaigns WHERE slug = $1 OR slug LIKE $2`, [base, `${base}-%`]);
  return firstFreeSlug(base, rows.rows.map((row) => row.slug));
}

async function completedOutcome(client: PoolClient, campaignId: string | null, status: "applied" | "duplicate", analytics: string | null) {
  if (!campaignId) throw new Error("CAMPAIGN_NOT_FOUND");
  const rows = await client.query<{ id: string; slug: string; rank: number }>(
    `SELECT c.id::text AS id, c.slug,
            (SELECT count(*)::int + 1 FROM campaigns ahead
              WHERE ahead.bid_cents > c.bid_cents
                 OR (ahead.bid_cents = c.bid_cents AND (ahead.bid_placed_at, ahead.id) < (c.bid_placed_at, c.id))) AS rank
       FROM campaigns c WHERE c.id = $1`, [campaignId],
  );
  if (!rows.rows[0]) throw new Error("CAMPAIGN_NOT_FOUND");
  return { status, campaignId: rows.rows[0].id, slug: rows.rows[0].slug, mode: "bid" as const, rank: rows.rows[0].rank, analytics };
}
