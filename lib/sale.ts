import type { PoolClient } from "pg";
import { trackServerEvent } from "./analytics";
import { config } from "./config";
import { lockBoard, withTransaction } from "./db";
import { promoteNextCampaign } from "./delivery";
import { firstFreeSlug, slugify } from "./slug";
import { trackXConversion } from "./x-ads";

export type PaidOrderInput = {
  intentId: string | null;
  orderId: string;
  providerTotalCents: number;
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
  twclid: string | null;
  status: string;
};

/**
 * Applies a paid checkout exactly once. The provider may retry webhooks and the local
 * completion route may be refreshed; both are safe because the order id and intent row
 * are locked before any campaign totals change.
 */
export async function applyPaidOrder(input: PaidOrderInput): Promise<PaidOrderOutcome> {
  const result = await withTransaction(async (client) => {
    await lockBoard(client);

    const duplicateOrder = await client.query<{
      campaign_id: string;
      slug: string;
      mode: PaidOrderOutcome["mode"];
    }>(
      `SELECT i.campaign_id::text AS campaign_id, c.slug, i.mode
         FROM checkout_intents i
         JOIN campaigns c ON c.id = i.campaign_id
        WHERE i.ls_order_id = $1 AND i.status = 'completed'
        LIMIT 1`,
      [input.orderId],
    );
    if (duplicateOrder.rows[0]) {
      return {
        campaignId: duplicateOrder.rows[0].campaign_id,
        slug: duplicateOrder.rows[0].slug,
        mode: duplicateOrder.rows[0].mode,
        status: "duplicate" as const,
        twclid: null,
      };
    }

    if (!input.intentId) throw new Error("MISSING_INTENT");
    const selected = await client.query<Intent>(
      `SELECT id::text AS id, mode, campaign_id::text AS campaign_id, clicks_delta,
              expected_amount_cents, target_priority_cents,
              display_name, url, pitch, icon_url, owner_token_hash, twclid, status
         FROM checkout_intents WHERE id = $1 FOR UPDATE`,
      [input.intentId],
    );
    const intent = selected.rows[0];
    if (!intent) throw new Error("INTENT_NOT_FOUND");
    if (intent.status === "completed") {
      const campaign = await campaignIdentity(client, intent.campaign_id);
      return { ...campaign, mode: intent.mode, status: "duplicate" as const, twclid: null };
    }
    // A provider-confirmed payment wins a race with local hold expiry. Rejecting it
    // would leave a paid buyer with neither inventory nor an automatic recovery path.
    if (intent.status !== "pending" && intent.status !== "expired") throw new Error("INTENT_INVALID");
    if (input.providerTotalCents < intent.expected_amount_cents) {
      throw new Error("PAYMENT_TOO_SMALL");
    }

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
              ls_order_id = $3, provider_total_cents = $4
        WHERE id = $1`,
      [intent.id, campaignId, input.orderId, input.providerTotalCents],
    );
    const campaign = await campaignIdentity(client, campaignId);
    return { ...campaign, mode: intent.mode, status: "applied" as const, twclid: intent.twclid };
  });

  if (result.status === "applied") {
    void trackServerEvent(
      result.mode === "purchase" ? "clicks_purchased" : "queue_jumped",
      { amountPaidCents: input.providerTotalCents, campaignId: result.campaignId },
      result.campaignId,
    );
    void trackXConversion({
      orderId: input.orderId,
      amountPaidCents: input.providerTotalCents,
      eventSourceUrl: `${config.siteUrl}/success?r=${input.intentId ?? ""}`,
      twclid: result.twclid,
    });
  }

  return {
    status: result.status,
    campaignId: result.campaignId,
    slug: result.slug,
    mode: result.mode,
  };
}

async function applyPurchase(client: PoolClient, intent: Intent): Promise<string> {
  if (!intent.url || !intent.display_name || intent.clicks_delta <= 0) {
    throw new Error("INVALID_PURCHASE");
  }
  if (intent.campaign_id) {
    const current = await client.query<{ status: string }>(
      `SELECT status::text AS status FROM campaigns WHERE id = $1 FOR UPDATE`,
      [intent.campaign_id],
    );
    if (!current.rows[0]) throw new Error("CAMPAIGN_NOT_FOUND");
    if (current.rows[0].status === "delivered") {
      await client.query(
        `UPDATE campaigns
            SET clicks_purchased = clicks_purchased + $2,
                amount_paid_cents = amount_paid_cents + $3,
                status = 'queued', priority_cents = 0,
                created_at = now(), started_at = NULL, delivered_at = NULL
          WHERE id = $1`,
        [intent.campaign_id, intent.clicks_delta, intent.expected_amount_cents],
      );
      await promoteNextCampaign(client);
    } else {
      // A live top-up keeps the original seven-day deadline. A queued top-up keeps its
      // place, including any paid priority, while adding more deliverable inventory.
      await client.query(
        `UPDATE campaigns
            SET clicks_purchased = clicks_purchased + $2,
                amount_paid_cents = amount_paid_cents + $3
          WHERE id = $1`,
        [intent.campaign_id, intent.clicks_delta, intent.expected_amount_cents],
      );
    }
    return intent.campaign_id;
  }

  const slug = await assignSlug(client, intent.display_name);
  const inserted = await client.query<{ id: string }>(
    `INSERT INTO campaigns
       (slug, url, product_name, pitch, icon_url, clicks_purchased,
        amount_paid_cents, owner_token_hash, status)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'queued')
     RETURNING id::text AS id`,
    [
      slug,
      intent.url,
      intent.display_name,
      intent.pitch,
      intent.icon_url,
      intent.clicks_delta,
      intent.expected_amount_cents,
      intent.owner_token_hash,
    ],
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

async function campaignIdentity(
  client: PoolClient,
  campaignId: string | null,
): Promise<{ campaignId: string; slug: string }> {
  if (!campaignId) throw new Error("CAMPAIGN_NOT_FOUND");
  const rows = await client.query<{ id: string; slug: string }>(
    `SELECT id::text AS id, slug FROM campaigns WHERE id = $1`,
    [campaignId],
  );
  if (!rows.rows[0]) throw new Error("CAMPAIGN_NOT_FOUND");
  return { campaignId: rows.rows[0].id, slug: rows.rows[0].slug };
}
