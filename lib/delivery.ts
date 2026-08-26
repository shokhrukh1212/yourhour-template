import type { PoolClient } from "pg";
import { dispatchPendingAnalytics, dispatchVemetricEvent, insertFunnelEvent } from "./analytics";
import { IP_RATE_LIMIT, RATE_WINDOW_MINUTES, VISITOR_RATE_LIMIT } from "./click";
import { lockBoard, withTransaction } from "./db";

export type ClickEventOutcome = "counted" | "duplicate" | "bot" | "owner" | "rate_limited" | "not_found" | "error";
export type ClickOutcome = { url: string | null; counted: boolean; eventOutcome: ClickEventOutcome; verifiedClicks: number };
export type RecordCampaignClickInput = {
  campaignId: string;
  visitorId: string;
  ipHash: string;
  userAgent: string;
  obviousBot?: boolean;
  ownerTokenHash?: string | null;
};

type LockedListing = { id: string; url: string; owner_token_hash: string | null; verified_clicks: number };

/** Counts at most one eligible outbound visit per anonymous visitor and product. */
export async function recordCampaignClick(input: RecordCampaignClickInput): Promise<ClickOutcome> {
  const result = await withTransaction(async (client) => {
    await lockBoard(client);
    const selected = await client.query<LockedListing>(
      `SELECT id::text, url, owner_token_hash, verified_clicks FROM campaigns WHERE id = $1 FOR UPDATE`,
      [input.campaignId],
    );
    const listing = selected.rows[0];
    if (!listing) {
      await insertEvent(client, input, "not_found", null);
      return { outcome: empty("not_found"), analyticsKey: null };
    }

    let eventOutcome: ClickEventOutcome | null = input.obviousBot ? "bot" : null;
    if (!eventOutcome) {
      const cookieOwner = Boolean(input.ownerTokenHash && listing.owner_token_hash && input.ownerTokenHash === listing.owner_token_hash);
      if (cookieOwner || await isPurchaseIp(client, listing.id, input.ipHash)) eventOutcome = "owner";
    }
    if (!eventOutcome && await isRateLimited(client, input.visitorId, input.ipHash)) eventOutcome = "rate_limited";
    if (eventOutcome) {
      await insertEvent(client, input, eventOutcome);
      return { outcome: { url: listing.url, counted: false, eventOutcome, verifiedClicks: listing.verified_clicks }, analyticsKey: null };
    }

    const inserted = await client.query(
      `INSERT INTO campaign_clicks (campaign_id, ip_hash, visitor_id, hour_bucket, is_bonus)
       VALUES ($1,$2,$3::uuid,date_trunc('hour', now()),false) ON CONFLICT DO NOTHING`,
      [listing.id, input.ipHash, input.visitorId],
    );
    const counted = Boolean(inserted.rowCount);
    const outcome: ClickEventOutcome = counted ? "counted" : "duplicate";
    const updated = counted
      ? await client.query<{ verified_clicks: number }>(`UPDATE campaigns SET verified_clicks = verified_clicks + 1 WHERE id = $1 RETURNING verified_clicks`, [listing.id])
      : null;
    await insertEvent(client, input, outcome);
    const analyticsKey = counted ? `listing:${listing.id}:visitor:${input.visitorId}` : null;
    if (analyticsKey) {
      await insertFunnelEvent(client, {
        name: "live_product_clicked", idempotencyKey: analyticsKey,
        visitorId: input.visitorId, campaignId: listing.id,
        eventData: { counted: true, mode: "leaderboard" },
      });
    }
    return {
      outcome: { url: listing.url, counted, eventOutcome: outcome, verifiedClicks: updated?.rows[0]?.verified_clicks ?? listing.verified_clicks },
      analyticsKey,
    };
  });
  if (result.analyticsKey) void dispatchVemetricEvent("live_product_clicked", result.analyticsKey);
  return result.outcome;
}

async function isPurchaseIp(client: PoolClient, campaignId: string, ipHash: string): Promise<boolean> {
  const rows = await client.query<{ own: boolean }>(
    `SELECT EXISTS (SELECT 1 FROM checkout_intents WHERE campaign_id = $1 AND status = 'completed' AND purchase_ip_hash = $2) AS own`,
    [campaignId, ipHash],
  );
  return Boolean(rows.rows[0]?.own);
}

async function isRateLimited(client: PoolClient, visitorId: string, ipHash: string): Promise<boolean> {
  const rows = await client.query<{ visitor_count: number; ip_count: number }>(
    `SELECT count(*) FILTER (WHERE visitor_id = $1::uuid)::int AS visitor_count,
            count(*) FILTER (WHERE ip_hash = $2)::int AS ip_count
       FROM campaign_click_events
      WHERE created_at >= now() - ($3::text || ' minutes')::interval
        AND outcome NOT IN ('bot','owner')`,
    [visitorId, ipHash, RATE_WINDOW_MINUTES],
  );
  return (rows.rows[0]?.visitor_count ?? 0) >= VISITOR_RATE_LIMIT || (rows.rows[0]?.ip_count ?? 0) >= IP_RATE_LIMIT;
}

async function insertEvent(client: PoolClient, input: RecordCampaignClickInput, outcome: ClickEventOutcome, campaignId: string | null = input.campaignId) {
  await client.query(
    `INSERT INTO campaign_click_events (campaign_id, visitor_id, ip_hash, user_agent, bonus_requested, outcome)
     VALUES ($1::bigint,$2::uuid,$3,$4,false,$5)`,
    [campaignId, input.visitorId, input.ipHash, input.userAgent.slice(0, 500), outcome],
  );
}

function empty(eventOutcome: ClickEventOutcome): ClickOutcome {
  return { url: null, counted: false, eventOutcome, verifiedClicks: 0 };
}

/** Daily cleanup now only expires unpaid bids and retries durable analytics delivery. */
export async function runCampaignMaintenance(): Promise<{ expired: number; analyticsDispatched: number }> {
  const expired = await withTransaction(async (client) => {
    const result = await client.query(`UPDATE checkout_intents SET status = 'expired' WHERE status = 'pending' AND expires_at <= now()`);
    return result.rowCount ?? 0;
  });
  const analyticsDispatched = await dispatchPendingAnalytics();
  return { expired, analyticsDispatched };
}
