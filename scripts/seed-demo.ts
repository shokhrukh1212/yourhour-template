/** Local campaign data for visual development. Never run against production. */
import { getPool, query } from "../lib/db";

const DEMO = [
  ["screenwar", "Screenwar", "https://screenwar.app", "A single screen that never scrolls.", 50, 18, 900, "live"],
  ["answerdeck", "Answerdeck", "https://answerdeck.com", "Source-grounded security questionnaire answers.", 20, 0, 700, "queued"],
  ["tamu-deals", "Tamu Deals", "https://example.com/tamu", "Better offers for growing teams.", 100, 0, 500, "queued"],
  ["ranked", "Ranked", "https://ranked.ai", "Get ranked everywhere you're searched.", 50, 50, 1200, "delivered"],
  ["overskill", "Overskill", "https://overskill.com", "Build production-ready apps with AI.", 100, 100, 1000, "delivered"],
  ["fiber", "Fiber", "https://fiber.so", "The private wallet for stablecoins.", 25, 25, 500, "delivered"],
] as const;

async function main() {
  if (process.env.NODE_ENV === "production") throw new Error("refusing to seed production");
  await query(`DELETE FROM campaign_clicks`);
  await query(`DELETE FROM checkout_intents`);
  await query(`DELETE FROM campaigns`);
  for (const [index, item] of DEMO.entries()) {
    const [slug, name, url, pitch, purchased, delivered, paid, status] = item;
    await query(
      `INSERT INTO campaigns
         (slug, product_name, url, pitch, clicks_purchased, clicks_delivered,
          amount_paid_cents, status, created_at, started_at, delivered_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8::campaign_status,
               now() - ($9 || ' days')::interval,
               CASE WHEN $8 <> 'queued' THEN now() - ($10 || ' hours')::interval END,
               CASE WHEN $8 = 'delivered' THEN now() - ($11 || ' hours')::interval END)`,
      [slug, name, url, pitch, purchased, delivered, paid, status, DEMO.length - index, index + 4, Math.max(1, index)],
    );
  }
  const live = await query<{ id: string }>(`SELECT id::text AS id FROM campaigns WHERE status = 'live'`);
  if (live[0]) {
    await query(
      `INSERT INTO campaign_clicks (campaign_id, ip_hash, hour_bucket, created_at)
       SELECT $1, md5(g::text), date_trunc('hour', now()), now()
         FROM generate_series(1, 18) g`,
      [live[0].id],
    );
  }
  console.log(`seeded ${DEMO.length} campaigns`);
  await getPool().end();
}

main().catch((error) => { console.error(error); process.exit(1); });
