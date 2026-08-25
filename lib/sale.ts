import type { PoolClient } from "pg";
import { dispatchVemetricEvent, dispatchXPurchase, insertFunnelEvent } from "./analytics";
import { config } from "./config";
import { lockBoard, withTransaction } from "./db";
import { promoteNextCampaign } from "./delivery";
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
  mode: "purchase" | "jump";
};

type Intent = {
  id: string;
  mode: "purchase" | "jump";
  campaign_id: string | null;
  clicks_delta: number;
  expected_amount_cents: number;
  target_priority_cents: number | null;
  display_name: string | null;
  url: string | null;
  pitch: string | null;
  icon_url: string | null;
  owner_token_hash: string | null;
  visitor_id: string | null;
  twclid: string | null;
  attribution: Record<string, unknown>;
  ls_order_id: string | null;
  status: string;
};

type InternalOutcome = PaidOrderOutcome & {
  visitorId: string | null;
  twclid: string | null;
  priceCents: number;
  clicks: number;
  attribution: Record<string, unknown>;
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

/** Apply a provider-verified payment exactly once, keyed by the provider order ID. */
export async function applyPaidOrder(input: PaidOrderInput): Promise<PaidOrderOutcome> {
  const result = await withTransaction(async (client): Promise<InternalOutcome> => {
    await lockBoard(client);
    const duplicateOrder = await client.query<{
      campaign_id: string;
      slug: string;
      mode: PaidOrderOutcome["mode"];
    }>(
      `SELECT i.campaign_id::text AS campaign_id, c.slug, i.mode
         FROM checkout_intents i JOIN campaigns c ON c.id = i.campaign_id
        WHERE i.ls_order_id = $1 AND i.status = 'completed' LIMIT 1`,
      [input.orderId],
    );
    if (duplicateOrder.rows[0]) {
      return {
        ...duplicateOrder.rows[0],
        campaignId: duplicateOrder.rows[0].campaign_id,
        status: "duplicate",
        visitorId: null,
        twclid: null,
        priceCents: 0,
        clicks: 0,
        attribution: {},
      };
    }

    if (!input.intentId) throw new Error("MISSING_INTENT");
    const selected = await client.query<Intent>(
      `SELECT id::text AS id, mode, campaign_id::text AS campaign_id, clicks_delta,
              expected_amount_cents, target_priority_cents, display_name, url, pitch,
              icon_url, owner_token_hash, visitor_id::text AS visitor_id, twclid,
              attribution, ls_order_id, status
         FROM checkout_intents WHERE id = $1 FOR UPDATE`,
      [input.intentId],
    );
    const intent = selected.rows[0];
    if (!intent) throw new Error("INTENT_NOT_FOUND");
    if (intent.status === "completed") {
      if (intent.ls_order_id !== input.orderId) throw new Error("INTENT_ALREADY_COMPLETED");
      const campaign = await campaignIdentity(client, intent.campaign_id);
      return {
        ...campaign,
        mode: intent.mode,
        status: "duplicate",
        visitorId: intent.visitor_id,
        twclid: intent.twclid,
        priceCents: intent.expected_amount_cents,
        clicks: intent.clicks_delta,
        attribution: intent.attribution,
      };
    }
    if (intent.status !== "pending" && intent.status !== "expired") throw new Error("INTENT_INVALID");
    const paymentError = paidOrderValidationError(intent.expected_amount_cents, input);
    if (paymentError) throw new Error(paymentError);

    let campaignId = intent.campaign_id;
    if (intent.mode === "purchase") {
      campaignId = await applyPurchase(client, intent);
    } else {
      if (!campaignId || intent.target_priority_cents === null) throw new Error("INVALID_JUMP");
      const updated = await client.query(
        `UPDATE campaigns
            SET priority_cents = CASE WHEN status = 'queued' THEN $2 ELSE priority_cents END,
                amount_paid_cents = amount_paid_cents + $3
          WHERE id = $1`,
        [campaignId, intent.target_priority_cents, intent.expected_amount_cents],
      );
      if (!updated.rowCount) throw new Error("CAMPAIGN_NOT_FOUND");
    }
    if (!campaignId) throw new Error("CAMPAIGN_NOT_CREATED");

    await client.query(
      `UPDATE checkout_intents
          SET campaign_id = $2, status = 'completed', completed_at = now(),
              delivery_deadline = CASE WHEN mode = 'purchase' THEN now() + interval '7 days' ELSE NULL END,
              ls_order_id = $3, provider_subtotal_cents = $4,
              provider_total_cents = $5, provider_currency = $6, provider_test_mode = $7
        WHERE id = $1`,
      [
        intent.id,
        campaignId,
        input.orderId,
        input.providerSubtotalCents,
        input.providerTotalCents,
        input.providerCurrency.toUpperCase(),
        input.providerTestMode,
      ],
    );
    const campaign = await campaignIdentity(client, campaignId);
    if (intent.mode === "purchase") {
      await insertFunnelEvent(client, {
        name: "purchase_completed",
        idempotencyKey: input.orderId,
        visitorId: intent.visitor_id,
        campaignId,
        checkoutIntentId: intent.id,
        orderId: input.orderId,
        eventData: {
          clickQuantity: intent.clicks_delta,
          priceCents: intent.expected_amount_cents,
          providerTotalCents: input.providerTotalCents,
          currency: input.providerCurrency.toUpperCase(),
          testMode: input.providerTestMode,
          twclid: intent.twclid,
          eventSourceUrl: `${config.siteUrl}/success?r=${intent.id}`,
          ...intent.attribution,
        },
      });
    }
    return {
      ...campaign,
      mode: intent.mode,
      status: "applied",
      visitorId: intent.visitor_id,
      twclid: intent.twclid,
      priceCents: intent.expected_amount_cents,
      clicks: intent.clicks_delta,
      attribution: intent.attribution,
    };
  });

  if (result.status === "applied" && result.mode === "purchase") {
    void dispatchVemetricEvent("purchase_completed", input.orderId);
    void dispatchXPurchase(input.orderId);
  }
  return { status: result.status, campaignId: result.campaignId, slug: result.slug, mode: result.mode };
}

async function applyPurchase(client: PoolClient, intent: Intent): Promise<string> {
  if (!intent.url || !intent.display_name || intent.clicks_delta <= 0) throw new Error("INVALID_PURCHASE");
  if (intent.campaign_id) {
    const current = await client.query<{ status: string; accounting_status: string }>(
      `SELECT status::text AS status, accounting_status FROM campaigns WHERE id = $1 FOR UPDATE`,
      [intent.campaign_id],
    );
    if (!current.rows[0]) throw new Error("CAMPAIGN_NOT_FOUND");
    if (current.rows[0].accounting_status === "legacy_total_only") throw new Error("LEGACY_CAMPAIGN_REQUIRES_NEW_RECORD");
    const wasDelivered = current.rows[0].status === "delivered";
    await client.query(
      `UPDATE campaigns
          SET purchased_clicks = purchased_clicks + $2,
              clicks_purchased = clicks_purchased + $2,
              amount_paid_cents = amount_paid_cents + $3,
              status = CASE WHEN $4 THEN 'queued'::campaign_status ELSE status END,
              priority_cents = CASE WHEN $4 THEN 0 ELSE priority_cents END,
              created_at = CASE WHEN $4 THEN now() ELSE created_at END,
              started_at = CASE WHEN $4 THEN NULL ELSE started_at END,
              delivered_at = CASE WHEN $4 THEN NULL ELSE delivered_at END
        WHERE id = $1`,
      [intent.campaign_id, intent.clicks_delta, intent.expected_amount_cents, wasDelivered],
    );
    if (wasDelivered) await promoteNextCampaign(client);
    return intent.campaign_id;
  }

  const slug = await assignSlug(client, intent.display_name);
  const inserted = await client.query<{ id: string }>(
    `INSERT INTO campaigns
       (slug, url, product_name, pitch, icon_url, clicks_purchased,
        clicks_delivered, accounting_status, purchased_clicks,
        guaranteed_clicks_delivered, bonus_clicks_delivered,
        historical_clicks_delivered, amount_paid_cents, owner_token_hash, status)
     VALUES ($1, $2, $3, $4, $5, $6, 0, 'verified', $6, 0, 0, 0, $7, $8, 'queued')
     RETURNING id::text AS id`,
    [slug, intent.url, intent.display_name, intent.pitch, intent.icon_url, intent.clicks_delta, intent.expected_amount_cents, intent.owner_token_hash],
  );
  await promoteNextCampaign(client);
  return inserted.rows[0].id;
}

async function assignSlug(client: PoolClient, name: string): Promise<string> {
  const base = slugify(name);
  const rows = await client.query<{ slug: string }>(
    `SELECT slug FROM campaigns WHERE slug = $1 OR slug LIKE $2`,
    [base, `${base}-%`],
  );
  return firstFreeSlug(base, rows.rows.map((row) => row.slug));
}

async function campaignIdentity(client: PoolClient, campaignId: string | null): Promise<{ campaignId: string; slug: string }> {
  if (!campaignId) throw new Error("CAMPAIGN_NOT_FOUND");
  const rows = await client.query<{ id: string; slug: string }>(
    `SELECT id::text AS id, slug FROM campaigns WHERE id = $1`,
    [campaignId],
  );
  if (!rows.rows[0]) throw new Error("CAMPAIGN_NOT_FOUND");
  return { campaignId: rows.rows[0].id, slug: rows.rows[0].slug };
}
