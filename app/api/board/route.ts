import { NextResponse } from "next/server";
import { query } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const ids = (new URL(request.url).searchParams.get("ids") ?? "")
    .split(",")
    .map((id) => id.trim())
    .filter((id) => /^\d+$/.test(id))
    .slice(0, 50);
  const rows = await query<{
    delivered_total: string;
    delivered_today: string;
    waiting: number;
    live_id: string | null;
    live_slug: string | null;
    live_product_name: string | null;
    live_pitch: string | null;
    live_icon_url: string | null;
    live_clicks_purchased: number | null;
    live_clicks_delivered: number | null;
    live_bonus_clicks: number | null;
    live_is_bonus: boolean | null;
    clicks: Record<string, number>;
    bonus_clicks: Record<string, number>;
  }>(
    `WITH summary AS (
       SELECT COALESCE(sum(clicks_delivered), 0)::text AS delivered_total,
              (SELECT count(*)::text FROM campaign_clicks
                WHERE created_at >= date_trunc('day', now())) AS delivered_today,
              count(*) FILTER (WHERE status = 'queued')::int AS waiting
         FROM campaigns
    ), paid_live AS (
       SELECT id::text, slug, product_name, pitch, icon_url,
              clicks_purchased, clicks_delivered, bonus_clicks, false AS is_bonus
         FROM campaigns WHERE status = 'live' LIMIT 1
    ), bonus AS (
       SELECT id::text, slug, product_name, pitch, icon_url,
              clicks_purchased, clicks_delivered, bonus_clicks, true AS is_bonus
         FROM campaigns
        WHERE status = 'delivered'
          AND clicks_purchased > 0
          AND bonus_clicks < COALESCE(bonus_click_cap, floor(clicks_purchased * 0.5)::int)
          AND NOT EXISTS (SELECT 1 FROM campaigns WHERE status IN ('live','queued'))
        ORDER BY clicks_delivered DESC, amount_paid_cents DESC, created_at ASC, id ASC
        LIMIT 1
    ), featured AS (
       SELECT * FROM paid_live
       UNION ALL
       SELECT * FROM bonus
       LIMIT 1
    ), requested AS (
       SELECT COALESCE(jsonb_object_agg(id::text, clicks_delivered), '{}'::jsonb) AS clicks,
              COALESCE(jsonb_object_agg(id::text, bonus_clicks), '{}'::jsonb) AS bonus_clicks
         FROM campaigns WHERE id = ANY($1::bigint[])
     )
     SELECT summary.delivered_total, summary.delivered_today, summary.waiting,
            featured.id AS live_id, featured.slug AS live_slug,
            featured.product_name AS live_product_name, featured.pitch AS live_pitch,
            featured.icon_url AS live_icon_url,
            featured.clicks_purchased AS live_clicks_purchased,
            featured.clicks_delivered AS live_clicks_delivered,
            featured.bonus_clicks AS live_bonus_clicks,
            featured.is_bonus AS live_is_bonus,
            requested.clicks, requested.bonus_clicks
       FROM summary CROSS JOIN requested LEFT JOIN featured ON true`,
    [ids],
  );
  const snapshot = rows[0];
  return NextResponse.json(
    {
      live: snapshot?.live_id
        ? {
            id: snapshot.live_id,
            slug: snapshot.live_slug,
            productName: snapshot.live_product_name,
            pitch: snapshot.live_pitch,
            iconUrl: snapshot.live_icon_url,
            clicksPurchased: snapshot.live_clicks_purchased,
            clicksDelivered: snapshot.live_clicks_delivered,
            bonusClicks: snapshot.live_bonus_clicks,
            bonus: snapshot.live_is_bonus ?? false,
          }
        : null,
      waiting: snapshot?.waiting ?? 0,
      deliveredTotal: Number(snapshot?.delivered_total ?? 0),
      deliveredToday: Number(snapshot?.delivered_today ?? 0),
      clicks: snapshot?.clicks ?? {},
      bonusClicks: snapshot?.bonus_clicks ?? {},
    },
    { headers: { "cache-control": "no-store" } },
  );
}
