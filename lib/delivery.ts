import type { PoolClient } from "pg";
import { isLemonSqueezyConfigured } from "./config";
import { lockBoard, query, withTransaction } from "./db";
import { getRefundedAmount, issueRefund } from "./lemonsqueezy";

const GUARANTEE_INTERVAL = "7 days";

export type ClickOutcome = {
  url: string | null;
  counted: boolean;
  completed: boolean;
  clicksDelivered: number;
  clicksPurchased: number;
  bonus: boolean;
};

export function guaranteedClicksDelivered(clicksDelivered: number, bonusClicks = 0): number {
  return Math.max(0, clicksDelivered - bonusClicks);
}

export function bonusClickLimit(clicksPurchased: number): number {
  return Math.floor(Math.max(0, clicksPurchased) * 0.5);
}

export function isCampaignComplete(clicksPurchased: number, clicksDelivered: number, clicksRefunded = 0, bonusClicks = 0): boolean {
  return guaranteedClicksDelivered(clicksDelivered, bonusClicks) + clicksRefunded >= clicksPurchased;
}

export async function recordCampaignClick(
  campaignId: string,
  ipHash: string,
  bonusRequested = false,
): Promise<ClickOutcome> {
  return withTransaction(async (client) => {
    await lockBoard(client);
    const selected = await client.query<{
      url: string;
      status: string;
      clicks_delivered: number;
      clicks_purchased: number;
      clicks_refunded: number;
      bonus_clicks: number;
      bonus_click_cap: number | null;
    }>(
      `SELECT url, status::text AS status, clicks_delivered, clicks_purchased,
              clicks_refunded, bonus_clicks, bonus_click_cap
         FROM campaigns WHERE id = $1 FOR UPDATE`,
      [campaignId],
    );
    const campaign = selected.rows[0];
    if (!campaign) {
      return { url: null, counted: false, completed: false, clicksDelivered: 0, clicksPurchased: 0, bonus: false };
    }
    const base = {
      url: campaign.url,
      counted: false,
      completed: false,
      clicksDelivered: campaign.clicks_delivered,
      clicksPurchased: campaign.clicks_purchased,
      bonus: false,
    };

    if (bonusRequested) {
      if (campaign.status !== "delivered") return base;
      const active = await client.query<{ id: string }>(
        `SELECT id::text AS id
           FROM campaigns
          WHERE status = 'delivered'
            AND clicks_purchased > 0
            AND bonus_clicks < COALESCE(bonus_click_cap, floor(clicks_purchased * 0.5)::int)
            AND NOT EXISTS (SELECT 1 FROM campaigns WHERE status IN ('live','queued'))
          ORDER BY clicks_delivered DESC, amount_paid_cents DESC, created_at ASC, id ASC
          LIMIT 1 FOR UPDATE`,
      );
      if (active.rows[0]?.id !== campaignId) return base;
      const buyer = await client.query<{ own: boolean }>(
        `SELECT EXISTS (
           SELECT 1 FROM checkout_intents
            WHERE campaign_id = $1 AND status = 'completed' AND purchase_ip_hash = $2
         ) AS own`,
        [campaignId, ipHash],
      );
      if (buyer.rows[0]?.own) return base;
      const inserted = await client.query(
        `INSERT INTO campaign_clicks (campaign_id, ip_hash, hour_bucket, is_bonus)
         VALUES ($1, $2, date_trunc('hour', now()), true)
         ON CONFLICT DO NOTHING`,
        [campaignId, ipHash],
      );
      if (!inserted.rowCount) return base;
      const updated = await client.query<{ clicks_delivered: number; clicks_purchased: number }>(
        `UPDATE campaigns
            SET bonus_click_cap = COALESCE(bonus_click_cap, floor(clicks_purchased * 0.5)::int),
                bonus_clicks = bonus_clicks + 1,
                clicks_delivered = clicks_delivered + 1
          WHERE id = $1 AND status = 'delivered'
            AND bonus_clicks < COALESCE(bonus_click_cap, floor(clicks_purchased * 0.5)::int)
          RETURNING clicks_delivered, clicks_purchased`,
        [campaignId],
      );
      if (!updated.rows[0]) return base;
      return {
        url: campaign.url,
        counted: true,
        completed: false,
        clicksDelivered: updated.rows[0].clicks_delivered,
        clicksPurchased: updated.rows[0].clicks_purchased,
        bonus: true,
      };
    }

    const deliveredOrRefunded = isCampaignComplete(campaign.clicks_purchased, campaign.clicks_delivered, campaign.clicks_refunded, campaign.bonus_clicks);
    if (campaign.status !== "live" || deliveredOrRefunded) {
      return base;
    }

    const buyer = await client.query<{ own: boolean }>(
      `SELECT EXISTS (
         SELECT 1 FROM checkout_intents
          WHERE campaign_id = $1 AND status = 'completed' AND purchase_ip_hash = $2
       ) AS own`,
      [campaignId, ipHash],
    );
    if (buyer.rows[0]?.own) return base;

    const inserted = await client.query(
      `INSERT INTO campaign_clicks (campaign_id, ip_hash, hour_bucket, is_bonus)
       VALUES ($1, $2, date_trunc('hour', now()), false)
       ON CONFLICT DO NOTHING`,
      [campaignId, ipHash],
    );
    if (!inserted.rowCount) return base;

    const updated = await client.query<{ clicks_delivered: number; clicks_purchased: number; clicks_refunded: number; bonus_clicks: number }>(
      `UPDATE campaigns
          SET clicks_delivered = clicks_delivered + 1
        WHERE id = $1 AND status = 'live'
          AND clicks_delivered - bonus_clicks < clicks_purchased - clicks_refunded
        RETURNING clicks_delivered, clicks_purchased, clicks_refunded, bonus_clicks`,
      [campaignId],
    );
    const value = updated.rows[0];
    if (!value) return base;

    const completed = isCampaignComplete(value.clicks_purchased, value.clicks_delivered, value.clicks_refunded, value.bonus_clicks);
    if (completed) {
      await client.query(
        `UPDATE campaigns
            SET status = 'delivered', delivered_at = now(), priority_cents = 0
          WHERE id = $1`,
        [campaignId],
      );
      await promoteNextCampaign(client);
    }
    return {
      url: campaign.url,
      counted: true,
      completed,
      clicksDelivered: value.clicks_delivered,
      clicksPurchased: value.clicks_purchased,
      bonus: false,
    };
  });
}

export async function promoteNextCampaign(client: PoolClient): Promise<string | null> {
  const live = await client.query(`SELECT 1 FROM campaigns WHERE status = 'live' LIMIT 1`);
  if (live.rows[0]) return null;
  const next = await client.query<{ id: string }>(
    `SELECT id::text AS id FROM campaigns
      WHERE status = 'queued'
      ORDER BY priority_cents DESC, created_at ASC, id ASC
      LIMIT 1 FOR UPDATE`,
  );
  if (!next.rows[0]) return null;
  await client.query(
    `UPDATE campaigns SET status = 'live', started_at = now(), delivered_at = NULL
      WHERE id = $1`,
    [next.rows[0].id],
  );
  return next.rows[0].id;
}

export async function runCampaignMaintenance(): Promise<{
  expiredIntents: number;
  guaranteedCampaigns: number;
  refundsReconciled: number;
  cap: number;
}> {
  const expiredIntents = await expireCheckoutIntents();
  const guaranteedCampaigns = await closeOverdueCampaigns();
  const refundsReconciled = await reconcileRefunds();
  const cap = await recomputeCapacityIfDue();
  return { expiredIntents, guaranteedCampaigns, refundsReconciled, cap };
}

async function expireCheckoutIntents(): Promise<number> {
  const rows = await query<{ id: string }>(
    `UPDATE checkout_intents SET status = 'expired'
      WHERE status = 'pending' AND expires_at <= now()
      RETURNING id::text AS id`,
  );
  return rows.length;
}

async function closeOverdueCampaigns(): Promise<number> {
  return withTransaction(async (client) => {
    await lockBoard(client);
    const overdue = await client.query<{
      id: string;
      clicks_purchased: number;
      clicks_delivered: number;
      bonus_clicks: number;
    }>(
      `SELECT id::text AS id, clicks_purchased, clicks_delivered, bonus_clicks
         FROM campaigns
        WHERE status = 'live' AND started_at + interval '${GUARANTEE_INTERVAL}' <= now()
        LIMIT 1 FOR UPDATE`,
    );
    const campaign = overdue.rows[0];
    if (!campaign) return 0;
    const currentRefunds = await client.query<{ clicks_refunded: number }>(
      `SELECT clicks_refunded FROM campaigns WHERE id = $1`,
      [campaign.id],
    );
    const undelivered = Math.max(
      0,
      campaign.clicks_purchased - guaranteedClicksDelivered(campaign.clicks_delivered, campaign.bonus_clicks) - (currentRefunds.rows[0]?.clicks_refunded ?? 0),
    );
    let remainingClicks = undelivered;
    const payments = await client.query<{
      id: string;
      clicks_delta: number;
      expected_amount_cents: number;
      refunded_cents: number;
    }>(
      `SELECT id::text AS id, clicks_delta, expected_amount_cents, refunded_cents
         FROM checkout_intents
        WHERE campaign_id = $1 AND mode = 'purchase' AND status = 'completed'
        ORDER BY completed_at DESC NULLS LAST, created_at DESC
        FOR UPDATE`,
      [campaign.id],
    );
    for (const payment of payments.rows) {
      if (remainingClicks <= 0) break;
      const clicksFromPayment = Math.min(remainingClicks, payment.clicks_delta);
      const paidForUndelivered = Math.round(
        payment.expected_amount_cents * clicksFromPayment / Math.max(1, payment.clicks_delta),
      );
      const targetDelta = Math.max(0, paidForUndelivered - payment.refunded_cents);
      if (targetDelta > 0) {
        await client.query(
          `UPDATE checkout_intents
              SET refund_target_cents = refund_target_cents + $2
            WHERE id = $1`,
          [payment.id, targetDelta],
        );
      }
      remainingClicks -= clicksFromPayment;
    }
    await client.query(
      `UPDATE campaigns
          SET status = 'delivered', delivered_at = now(), clicks_refunded = clicks_refunded + $2,
              priority_cents = 0
        WHERE id = $1`,
      [campaign.id, undelivered],
    );
    await promoteNextCampaign(client);
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
      FROM checkout_intents
      WHERE status = 'completed' AND refund_target_cents > refunded_cents
        AND (refund_lock_until IS NULL OR refund_lock_until <= now())
      ORDER BY created_at ASC`,
  );
  let reconciled = 0;
  for (const payment of pending) {
    const locked = await query<{ id: string; ls_order_id: string | null; refund_target_cents: number }>(
      `UPDATE checkout_intents
          SET refund_lock_until = now() + interval '10 minutes'
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
      const total = delta > 0
        ? await issueRefund(payment.ls_order_id, delta)
        : providerRefunded;
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
  if (!rows[0]?.due) return rows[0]?.max_outstanding_clicks ?? 150;
  const updated = await query<{ max_outstanding_clicks: number }>(
    `UPDATE site_config
        SET max_outstanding_clicks = GREATEST(
              150,
              3 * (SELECT count(*)::int FROM campaign_clicks
                    WHERE created_at >= now() - interval '24 hours' AND NOT is_bonus)
            ),
            cap_recomputed_at = now()
      WHERE singleton = true
      RETURNING max_outstanding_clicks`,
  );
  return updated[0]?.max_outstanding_clicks ?? 150;
}
