import type { PoolClient } from "pg";
import { dispatchPendingAnalytics, dispatchVemetricEvent, insertFunnelEvent } from "./analytics";
import { IP_RATE_LIMIT, RATE_WINDOW_MINUTES, VISITOR_RATE_LIMIT } from "./click";
import { isLemonSqueezyConfigured } from "./config";
import { lockBoard, query, withTransaction } from "./db";
import { getRefundedAmount, issueRefund } from "./lemonsqueezy";

export type ClickEventOutcome =
  | "counted_guaranteed"
  | "counted_bonus"
  | "duplicate"
  | "bot"
  | "owner"
  | "rate_limited"
  | "not_active"
  | "not_found"
  | "error";

export type ClickOutcome = {
  url: string | null;
  counted: boolean;
  completed: boolean;
  guaranteedClicksDelivered: number;
  purchasedClicks: number | null;
  bonusClicksDelivered: number;
  totalClicksDelivered: number;
  bonus: boolean;
  eventOutcome: ClickEventOutcome;
};

export type RecordCampaignClickInput = {
  campaignId: string;
  visitorId: string;
  ipHash: string;
  userAgent: string;
  bonusRequested?: boolean;
  obviousBot?: boolean;
  ownerTokenHash?: string | null;
};

type LockedCampaign = {
  id: string;
  url: string;
  status: string;
  owner_token_hash: string | null;
  clicks_purchased: number;
  clicks_delivered: number;
  bonus_clicks: number;
  clicks_refunded: number;
  purchased_clicks: number | null;
  guaranteed_clicks_delivered: number | null;
  bonus_clicks_delivered: number;
  total_clicks_delivered: number;
  bonus_round_clicks_delivered: number;
  bonus_click_cap: number | null;
};

export function guaranteedClicksDelivered(clicksDelivered: number, bonusClicks = 0): number {
  return Math.max(0, clicksDelivered - bonusClicks);
}

export function bonusClickLimit(clicksPurchased: number): number {
  return Math.floor(Math.max(0, clicksPurchased) * 0.5);
}

export function isCampaignComplete(
  clicksPurchased: number,
  clicksDelivered: number,
  clicksRefunded = 0,
  bonusClicks = 0,
): boolean {
  return guaranteedClicksDelivered(clicksDelivered, bonusClicks) + clicksRefunded >= clicksPurchased;
}

export function isCanonicalCampaignComplete(
  purchasedClicks: number | null,
  guaranteedDelivered: number | null,
  refundedClicks = 0,
): boolean {
  return purchasedClicks !== null
    && guaranteedDelivered !== null
    && guaranteedDelivered + refundedClicks >= purchasedClicks;
}

export async function recordCampaignClick(input: RecordCampaignClickInput): Promise<ClickOutcome> {
  const result = await withTransaction(async (client) => {
    await lockBoard(client);
    const selected = await client.query<LockedCampaign>(
      `SELECT id::text AS id, url, status::text AS status, owner_token_hash,
              clicks_purchased, clicks_delivered, bonus_clicks, clicks_refunded,
              purchased_clicks, guaranteed_clicks_delivered,
              bonus_clicks_delivered, total_clicks_delivered,
              bonus_round_clicks_delivered, bonus_click_cap
         FROM campaigns WHERE id = $1 FOR UPDATE`,
      [input.campaignId],
    );
    const campaign = selected.rows[0];
    if (!campaign) {
      await insertRawClickEvent(client, input, "not_found", null);
      return { outcome: emptyOutcome(null, "not_found"), analyticsInserted: false, analyticsKey: null };
    }

    const base = campaignOutcome(campaign, "not_active");
    let eventOutcome: ClickEventOutcome | null = null;
    if (input.obviousBot) {
      eventOutcome = "bot";
    } else {
      const cookieOwner = Boolean(
        input.ownerTokenHash
        && campaign.owner_token_hash
        && input.ownerTokenHash === campaign.owner_token_hash,
      );
      if (cookieOwner || await isPurchaseIp(client, campaign.id, input.ipHash)) eventOutcome = "owner";
    }
    if (!eventOutcome && await isRateLimited(client, input.visitorId, input.ipHash)) {
      eventOutcome = "rate_limited";
    }
    if (eventOutcome) {
      await insertRawClickEvent(client, input, eventOutcome);
      return { outcome: { ...base, eventOutcome }, analyticsInserted: false, analyticsKey: null };
    }

    const outcome = input.bonusRequested
      ? await countBonusClick(client, campaign, input)
      : await countGuaranteedClick(client, campaign, input);
    await insertRawClickEvent(client, input, outcome.eventOutcome);

    const analyticsKey = `campaign:${campaign.id}:visitor:${input.visitorId}`;
    const analyticsInserted = await insertFunnelEvent(client, {
      name: "live_product_clicked",
      idempotencyKey: analyticsKey,
      visitorId: input.visitorId,
      campaignId: campaign.id,
      eventData: { counted: outcome.counted, bonus: outcome.bonus, outcome: outcome.eventOutcome },
    });
    return { outcome, analyticsInserted, analyticsKey };
  });

  if (result.analyticsInserted && result.analyticsKey) {
    void dispatchVemetricEvent("live_product_clicked", result.analyticsKey);
  }
  return result.outcome;
}

async function countGuaranteedClick(
  client: PoolClient,
  campaign: LockedCampaign,
  input: RecordCampaignClickInput,
): Promise<ClickOutcome> {
  if (
    campaign.status !== "live"
    || campaign.purchased_clicks === null
    || campaign.guaranteed_clicks_delivered === null
    || isCanonicalCampaignComplete(campaign.purchased_clicks, campaign.guaranteed_clicks_delivered, campaign.clicks_refunded)
  ) return campaignOutcome(campaign, "not_active");

  if (!await insertCountedClick(client, input, false)) return campaignOutcome(campaign, "duplicate");
  const updated = await client.query<LockedCampaign>(
    `UPDATE campaigns
        SET guaranteed_clicks_delivered = guaranteed_clicks_delivered + 1,
            clicks_delivered = clicks_delivered + 1
      WHERE id = $1 AND status = 'live'
        AND guaranteed_clicks_delivered < purchased_clicks - clicks_refunded
      RETURNING id::text AS id, url, status::text AS status, owner_token_hash,
                clicks_purchased, clicks_delivered, bonus_clicks, clicks_refunded,
                purchased_clicks, guaranteed_clicks_delivered,
                bonus_clicks_delivered, total_clicks_delivered,
                bonus_round_clicks_delivered, bonus_click_cap`,
    [campaign.id],
  );
  const value = updated.rows[0];
  if (!value) return campaignOutcome(campaign, "not_active");

  await allocateGuaranteedClick(client, campaign.id);
  const completed = isCanonicalCampaignComplete(value.purchased_clicks, value.guaranteed_clicks_delivered, value.clicks_refunded);
  if (completed) {
    await client.query(
      `UPDATE campaigns SET status = 'delivered', delivered_at = now(), priority_cents = 0 WHERE id = $1`,
      [campaign.id],
    );
    await promoteNextCampaign(client);
  }
  return { ...campaignOutcome(value, "counted_guaranteed"), counted: true, completed };
}

async function countBonusClick(
  client: PoolClient,
  campaign: LockedCampaign,
  input: RecordCampaignClickInput,
): Promise<ClickOutcome> {
  if (campaign.status !== "delivered") return campaignOutcome(campaign, "not_active");
  const active = await client.query<{ id: string }>(
    `SELECT id::text AS id FROM campaigns
      WHERE status = 'delivered' AND clicks_purchased > 0
        AND bonus_round_clicks_delivered < COALESCE(bonus_click_cap, floor(clicks_purchased * 0.5)::int)
        AND NOT EXISTS (SELECT 1 FROM campaigns WHERE status IN ('live','queued'))
      ORDER BY total_clicks_delivered DESC, amount_paid_cents DESC, created_at ASC, id ASC
      LIMIT 1 FOR UPDATE`,
  );
  if (active.rows[0]?.id !== campaign.id) return campaignOutcome(campaign, "not_active");
  if (!await insertCountedClick(client, input, true)) return campaignOutcome(campaign, "duplicate");

  const updated = await client.query<LockedCampaign>(
    `UPDATE campaigns
        SET bonus_click_cap = COALESCE(bonus_click_cap, floor(clicks_purchased * 0.5)::int),
            bonus_round_clicks_delivered = bonus_round_clicks_delivered + 1,
            bonus_clicks_delivered = bonus_clicks_delivered + 1,
            bonus_clicks = bonus_clicks + 1,
            clicks_delivered = clicks_delivered + 1
      WHERE id = $1 AND status = 'delivered'
        AND bonus_round_clicks_delivered < COALESCE(bonus_click_cap, floor(clicks_purchased * 0.5)::int)
      RETURNING id::text AS id, url, status::text AS status, owner_token_hash,
                clicks_purchased, clicks_delivered, bonus_clicks, clicks_refunded,
                purchased_clicks, guaranteed_clicks_delivered,
                bonus_clicks_delivered, total_clicks_delivered,
                bonus_round_clicks_delivered, bonus_click_cap`,
    [campaign.id],
  );
  const value = updated.rows[0];
  if (!value) return campaignOutcome(campaign, "not_active");
  return { ...campaignOutcome(value, "counted_bonus"), counted: true, bonus: true };
}

async function insertCountedClick(client: PoolClient, input: RecordCampaignClickInput, bonus: boolean): Promise<boolean> {
  const inserted = await client.query(
    `INSERT INTO campaign_clicks (campaign_id, ip_hash, visitor_id, hour_bucket, is_bonus)
     VALUES ($1, $2, $3::uuid, date_trunc('hour', now()), $4) ON CONFLICT DO NOTHING`,
    [input.campaignId, input.ipHash, input.visitorId, bonus],
  );
  return Boolean(inserted.rowCount);
}

async function allocateGuaranteedClick(client: PoolClient, campaignId: string): Promise<void> {
  await client.query(
    `UPDATE checkout_intents SET guaranteed_clicks_delivered = guaranteed_clicks_delivered + 1
      WHERE id = (
        SELECT id FROM checkout_intents
         WHERE campaign_id = $1 AND mode = 'purchase' AND status = 'completed'
           AND guaranteed_clicks_delivered + guaranteed_clicks_refunded < clicks_delta
         ORDER BY completed_at ASC NULLS LAST, created_at ASC LIMIT 1 FOR UPDATE
      )`,
    [campaignId],
  );
}

async function isPurchaseIp(client: PoolClient, campaignId: string, ipHash: string): Promise<boolean> {
  const buyer = await client.query<{ own: boolean }>(
    `SELECT EXISTS (SELECT 1 FROM checkout_intents
      WHERE campaign_id = $1 AND status = 'completed' AND purchase_ip_hash = $2) AS own`,
    [campaignId, ipHash],
  );
  return Boolean(buyer.rows[0]?.own);
}

async function isRateLimited(client: PoolClient, visitorId: string, ipHash: string): Promise<boolean> {
  const counts = await client.query<{ visitor_count: number; ip_count: number }>(
    `SELECT count(*) FILTER (WHERE visitor_id = $1::uuid)::int AS visitor_count,
            count(*) FILTER (WHERE ip_hash = $2)::int AS ip_count
       FROM campaign_click_events
      WHERE created_at >= now() - ($3::text || ' minutes')::interval
        AND outcome NOT IN ('bot', 'owner')`,
    [visitorId, ipHash, RATE_WINDOW_MINUTES],
  );
  return (counts.rows[0]?.visitor_count ?? 0) >= VISITOR_RATE_LIMIT
    || (counts.rows[0]?.ip_count ?? 0) >= IP_RATE_LIMIT;
}

async function insertRawClickEvent(client: PoolClient, input: RecordCampaignClickInput, outcome: ClickEventOutcome, campaignId: string | null = input.campaignId): Promise<void> {
  await client.query(
    `INSERT INTO campaign_click_events
       (campaign_id, visitor_id, ip_hash, user_agent, bonus_requested, outcome)
     VALUES ($1::bigint, $2::uuid, $3, $4, $5, $6)`,
    [campaignId, input.visitorId, input.ipHash, input.userAgent.slice(0, 500), Boolean(input.bonusRequested), outcome],
  );
}

function campaignOutcome(campaign: LockedCampaign, eventOutcome: ClickEventOutcome): ClickOutcome {
  return {
    url: campaign.url,
    counted: false,
    completed: false,
    guaranteedClicksDelivered: campaign.guaranteed_clicks_delivered ?? 0,
    purchasedClicks: campaign.purchased_clicks,
    bonusClicksDelivered: campaign.bonus_clicks_delivered,
    totalClicksDelivered: campaign.total_clicks_delivered,
    bonus: false,
    eventOutcome,
  };
}

function emptyOutcome(url: string | null, eventOutcome: ClickEventOutcome): ClickOutcome {
  return {
    url,
    counted: false,
    completed: false,
    guaranteedClicksDelivered: 0,
    purchasedClicks: null,
    bonusClicksDelivered: 0,
    totalClicksDelivered: 0,
    bonus: false,
    eventOutcome,
  };
}

export async function promoteNextCampaign(client: PoolClient): Promise<string | null> {
  const live = await client.query(`SELECT 1 FROM campaigns WHERE status = 'live' LIMIT 1`);
  if (live.rows[0]) return null;
  const next = await client.query<{ id: string }>(
    `SELECT id::text AS id FROM campaigns WHERE status = 'queued'
      ORDER BY priority_cents DESC, created_at ASC, id ASC LIMIT 1 FOR UPDATE`,
  );
  if (!next.rows[0]) return null;
  await client.query(
    `UPDATE campaigns SET status = 'live', started_at = now(), delivered_at = NULL WHERE id = $1`,
    [next.rows[0].id],
  );
  return next.rows[0].id;
}

export async function runCampaignMaintenance(): Promise<{
  expiredIntents: number;
  guaranteedCampaigns: number;
  refundsReconciled: number;
  analyticsDispatched: number;
  cap: number;
}> {
  const expiredIntents = await expireCheckoutIntents();
  const guaranteedCampaigns = await closeOverduePurchases();
  const refundsReconciled = await reconcileRefunds();
  const analyticsDispatched = await dispatchPendingAnalytics();
  const cap = await recomputeCapacityIfDue();
  return { expiredIntents, guaranteedCampaigns, refundsReconciled, analyticsDispatched, cap };
}

async function expireCheckoutIntents(): Promise<number> {
  const rows = await query<{ id: string }>(
    `UPDATE checkout_intents SET status = 'expired'
      WHERE status = 'pending' AND expires_at <= now() RETURNING id::text AS id`,
  );
  return rows.length;
}

async function closeOverduePurchases(): Promise<number> {
  return withTransaction(async (client) => {
    await lockBoard(client);
    const overdue = await client.query<{
      id: string;
      campaign_id: string;
      clicks_delta: number;
      guaranteed_clicks_delivered: number;
      guaranteed_clicks_refunded: number;
      expected_amount_cents: number;
      refunded_cents: number;
    }>(
      `SELECT id::text AS id, campaign_id::text AS campaign_id, clicks_delta,
              guaranteed_clicks_delivered, guaranteed_clicks_refunded,
              expected_amount_cents, refunded_cents
         FROM checkout_intents
        WHERE mode = 'purchase' AND status = 'completed'
          AND delivery_deadline IS NOT NULL AND delivery_deadline <= now()
          AND guaranteed_clicks_delivered + guaranteed_clicks_refunded < clicks_delta
        ORDER BY delivery_deadline ASC, created_at ASC LIMIT 1 FOR UPDATE`,
    );
    const purchase = overdue.rows[0];
    if (!purchase) return 0;
    const undelivered = Math.max(0, purchase.clicks_delta - purchase.guaranteed_clicks_delivered - purchase.guaranteed_clicks_refunded);
    const targetRefund = Math.round(purchase.expected_amount_cents * undelivered / Math.max(1, purchase.clicks_delta));
    await client.query(
      `UPDATE checkout_intents
          SET guaranteed_clicks_refunded = guaranteed_clicks_refunded + $2,
              refund_target_cents = GREATEST(refund_target_cents, $3)
        WHERE id = $1`,
      [purchase.id, undelivered, targetRefund],
    );
    await client.query(`UPDATE campaigns SET clicks_refunded = clicks_refunded + $2 WHERE id = $1`, [purchase.campaign_id, undelivered]);
    const remaining = await client.query<{ remaining: number }>(
      `SELECT COALESCE(sum(clicks_delta - guaranteed_clicks_delivered - guaranteed_clicks_refunded), 0)::int AS remaining
         FROM checkout_intents WHERE campaign_id = $1 AND mode = 'purchase' AND status = 'completed'`,
      [purchase.campaign_id],
    );
    if ((remaining.rows[0]?.remaining ?? 0) === 0) {
      await client.query(
        `UPDATE campaigns SET status = 'delivered', delivered_at = COALESCE(delivered_at, now()), priority_cents = 0
          WHERE id = $1 AND status <> 'delivered'`,
        [purchase.campaign_id],
      );
      await promoteNextCampaign(client);
    }
    return 1;
  });
}

async function reconcileRefunds(): Promise<number> {
  const pending = await query<{
    id: string;
    ls_order_id: string | null;
    refund_target_cents: number;
    refunded_cents: number;
  }>(
    `SELECT id::text AS id, ls_order_id, refund_target_cents, refunded_cents
      FROM checkout_intents WHERE status = 'completed' AND refund_target_cents > refunded_cents
        AND (refund_lock_until IS NULL OR refund_lock_until <= now()) ORDER BY created_at ASC`,
  );
  let reconciled = 0;
  for (const payment of pending) {
    const locked = await query<{ id: string; ls_order_id: string | null; refund_target_cents: number }>(
      `UPDATE checkout_intents SET refund_lock_until = now() + interval '10 minutes'
        WHERE id = $1 AND refund_target_cents > refunded_cents
          AND (refund_lock_until IS NULL OR refund_lock_until <= now())
      RETURNING id::text AS id, ls_order_id, refund_target_cents`,
      [payment.id],
    );
    if (!locked[0]) continue;
    try {
      if (!payment.ls_order_id || payment.ls_order_id.startsWith("dev-") || !isLemonSqueezyConfigured()) {
        await query(`UPDATE checkout_intents SET refunded_cents = refund_target_cents, refund_lock_until = NULL WHERE id = $1`, [payment.id]);
        reconciled += 1;
        continue;
      }
      const providerRefunded = await getRefundedAmount(payment.ls_order_id);
      const delta = Math.max(0, payment.refund_target_cents - providerRefunded);
      const total = delta > 0 ? await issueRefund(payment.ls_order_id, delta) : providerRefunded;
      await query(
        `UPDATE checkout_intents SET refunded_cents = LEAST(refund_target_cents, $2), refund_lock_until = NULL WHERE id = $1`,
        [payment.id, total],
      );
      reconciled += 1;
    } catch (error) {
      await query(`UPDATE checkout_intents SET refund_lock_until = NULL WHERE id = $1`, [payment.id]).catch(() => {});
      console.error(`refund reconciliation failed for intent ${payment.id}`, error);
    }
  }
  return reconciled;
}

async function recomputeCapacityIfDue(): Promise<number> {
  const rows = await query<{ max_outstanding_clicks: number; due: boolean }>(
    `SELECT max_outstanding_clicks, cap_recomputed_at <= now() - interval '1 day' AS due
       FROM site_config WHERE singleton = true`,
  );
  if (!rows[0]?.due) return rows[0]?.max_outstanding_clicks ?? 250;
  const updated = await query<{ max_outstanding_clicks: number }>(
    `UPDATE site_config SET max_outstanding_clicks = GREATEST(
          250, 3 * (SELECT count(*)::int FROM campaign_clicks
                    WHERE created_at >= now() - interval '24 hours' AND NOT is_bonus)
        ), cap_recomputed_at = now()
      WHERE singleton = true RETURNING max_outstanding_clicks`,
  );
  return updated[0]?.max_outstanding_clicks ?? 250;
}
