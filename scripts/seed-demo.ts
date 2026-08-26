/** Local leaderboard data for visual development. Never run against production. */
import { getPool, query } from "../lib/db";

const DEMO = [
  ["assumio", "Assumio", "https://assumio.com", "Know the cost and risks of your AI feature before writing code.", 1700, 142],
  ["screenwar", "Screenwar", "https://screenwar.app", "Turn screen time into focused work sessions.", 1600, 98],
  ["tamu-deals", "Tamu Deals", "https://tamudeals.com", "Simple travel deals, curated daily.", 1200, 74],
  ["answerdeck", "Answerdeck", "https://answerdeck.com", "Turn customer questions into useful answers.", 900, 51],
  ["briefly", "Briefly", "https://briefly.so", "Fast meeting notes for small product teams.", 700, 38],
] as const;

async function main() {
  if (process.env.NODE_ENV === "production") throw new Error("refusing to seed production");
  await query(`DELETE FROM campaign_click_events`);
  await query(`DELETE FROM campaign_clicks`);
  await query(`DELETE FROM checkout_intents`);
  await query(`DELETE FROM campaigns`);
  for (const [index, [slug, name, url, pitch, bid, clicks]] of DEMO.entries()) {
    const domain = new URL(url).hostname.replace(/^www\./, "");
    await query(
      `INSERT INTO campaigns
         (slug,url,normalized_domain,product_name,pitch,clicks_purchased,clicks_delivered,
          accounting_status,purchased_clicks,guaranteed_clicks_delivered,
          amount_paid_cents,bid_cents,verified_clicks,bid_placed_at,status,started_at,delivered_at)
       VALUES ($1,$2,$3,$4,$5,0,0,'verified',0,0,$6,$6,$7,now() + ($8 || ' seconds')::interval,'delivered',now(),now())`,
      [slug, url, domain, name, pitch, bid, clicks, index],
    );
  }
  console.log(`seeded ${DEMO.length} leaderboard products`);
  await getPool().end();
}
main().catch((error) => { console.error(error); process.exit(1); });
