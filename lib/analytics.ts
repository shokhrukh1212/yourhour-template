import type { PoolClient } from "pg";
import { Vemetric } from "@vemetric/node";
import { config } from "./config";
import { query } from "./db";
import { trackXConversion } from "./x-ads";

export const FUNNEL_EVENTS = [
  "buyer_landing_viewed",
  "product_url_submitted",
  "claim_opened",
  "checkout_started",
  "purchase_completed",
  "live_product_clicked",
] as const;

export type FunnelEventName = (typeof FUNNEL_EVENTS)[number];

type FunnelEventInput = {
  name: FunnelEventName;
  idempotencyKey: string;
  visitorId?: string | null;
  campaignId?: string | null;
  checkoutIntentId?: string | null;
  orderId?: string | null;
  eventData?: Record<string, unknown>;
};

type StoredEvent = {
  id: string;
  event_name: FunnelEventName;
  idempotency_key: string;
  visitor_id: string | null;
  event_data: Record<string, unknown>;
  vemetric_sent_at: Date | null;
};

type StoredPurchaseEvent = StoredEvent & {
  order_id: string | null;
  x_sent_at: Date | null;
};

let client: Vemetric | null = null;

function getClient(): Vemetric | null {
  if (!config.vemetric.token) return null;
  if (!client) client = new Vemetric({ token: config.vemetric.token });
  return client;
}

export async function insertFunnelEvent(
  client: PoolClient,
  input: FunnelEventInput,
): Promise<boolean> {
  const inserted = await client.query(
    `INSERT INTO analytics_events
       (event_name, idempotency_key, visitor_id, campaign_id,
        checkout_intent_id, order_id, event_data)
     VALUES ($1, $2, $3::uuid, $4::bigint, $5::uuid, $6, $7::jsonb)
     ON CONFLICT (event_name, idempotency_key) DO NOTHING`,
    [
      input.name,
      input.idempotencyKey,
      input.visitorId ?? null,
      input.campaignId ?? null,
      input.checkoutIntentId ?? null,
      input.orderId ?? null,
      JSON.stringify(input.eventData ?? {}),
    ],
  );
  return Boolean(inserted.rowCount);
}

export async function recordFunnelEvent(input: FunnelEventInput): Promise<boolean> {
  const inserted = await query<{ id: string }>(
    `INSERT INTO analytics_events
       (event_name, idempotency_key, visitor_id, campaign_id,
        checkout_intent_id, order_id, event_data)
     VALUES ($1, $2, $3::uuid, $4::bigint, $5::uuid, $6, $7::jsonb)
     ON CONFLICT (event_name, idempotency_key) DO NOTHING
     RETURNING id::text AS id`,
    [
      input.name,
      input.idempotencyKey,
      input.visitorId ?? null,
      input.campaignId ?? null,
      input.checkoutIntentId ?? null,
      input.orderId ?? null,
      JSON.stringify(input.eventData ?? {}),
    ],
  );
  if (!inserted[0]) return false;
  void dispatchVemetricEvent(input.name, input.idempotencyKey);
  return true;
}

export async function dispatchVemetricEvent(
  name: FunnelEventName,
  idempotencyKey: string,
): Promise<void> {
  const vemetric = getClient();
  if (!vemetric) return;
  const rows = await query<StoredEvent>(
    `SELECT id::text AS id, event_name, idempotency_key,
            visitor_id::text AS visitor_id, event_data, vemetric_sent_at
       FROM analytics_events
      WHERE event_name = $1 AND idempotency_key = $2`,
    [name, idempotencyKey],
  );
  const event = rows[0];
  if (!event || event.vemetric_sent_at) return;
  try {
    await vemetric.trackEvent(event.event_name, {
      userIdentifier: event.visitor_id ?? "anonymous",
      eventData: { ...event.event_data, eventId: event.idempotency_key },
    });
    await query(
      `UPDATE analytics_events
          SET vemetric_sent_at = now(), delivery_attempts = delivery_attempts + 1,
              last_error = NULL
        WHERE id = $1 AND vemetric_sent_at IS NULL`,
      [event.id],
    );
  } catch (error) {
    await query(
      `UPDATE analytics_events
          SET delivery_attempts = delivery_attempts + 1, last_error = $2
        WHERE id = $1`,
      [event.id, error instanceof Error ? error.message.slice(0, 500) : "Vemetric delivery failed"],
    ).catch(() => {});
  }
}

export async function dispatchXPurchase(idempotencyKey: string): Promise<void> {
  const rows = await query<StoredPurchaseEvent>(
    `SELECT id::text AS id, event_name, idempotency_key,
            visitor_id::text AS visitor_id, order_id, event_data,
            vemetric_sent_at, x_sent_at
       FROM analytics_events
      WHERE event_name = 'purchase_completed' AND idempotency_key = $1`,
    [idempotencyKey],
  );
  const event = rows[0];
  if (!event || event.x_sent_at || !event.order_id) return;
  const amountPaidCents = Number(event.event_data.providerTotalCents ?? event.event_data.priceCents ?? 0);
  const result = await trackXConversion({
    orderId: event.order_id,
    amountPaidCents,
    eventSourceUrl: String(event.event_data.eventSourceUrl ?? config.siteUrl),
    twclid: typeof event.event_data.twclid === "string" ? event.event_data.twclid : null,
  });
  if (result === "failed") {
    await query(
      `UPDATE analytics_events SET delivery_attempts = delivery_attempts + 1,
              last_error = 'X conversion delivery failed' WHERE id = $1`,
      [event.id],
    ).catch(() => {});
    return;
  }
  await query(
    `UPDATE analytics_events SET x_sent_at = now(), delivery_attempts = delivery_attempts + 1,
            last_error = NULL WHERE id = $1 AND x_sent_at IS NULL`,
    [event.id],
  );
}

export async function dispatchPendingAnalytics(limit = 25): Promise<number> {
  const rows = await query<{ event_name: FunnelEventName; idempotency_key: string; vemetric_pending: boolean; x_pending: boolean }>(
    `SELECT event_name, idempotency_key,
            (vemetric_sent_at IS NULL) AS vemetric_pending,
            (event_name = 'purchase_completed' AND x_sent_at IS NULL) AS x_pending
       FROM analytics_events
      WHERE vemetric_sent_at IS NULL
         OR (event_name = 'purchase_completed' AND x_sent_at IS NULL)
      ORDER BY (event_name = 'purchase_completed' AND x_sent_at IS NULL) DESC,
               created_at ASC LIMIT $1`,
    [limit],
  );
  for (const event of rows) {
    if (event.vemetric_pending) {
      await dispatchVemetricEvent(event.event_name, event.idempotency_key);
    }
    if (event.x_pending) await dispatchXPurchase(event.idempotency_key);
  }
  return rows.length;
}
