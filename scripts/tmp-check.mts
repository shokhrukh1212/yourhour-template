import { query } from "../lib/db";
const rows = await query<any>(`SELECT id::text AS id, product_name, bid_cents, bid_placed_at, created_at FROM campaigns ORDER BY bid_cents DESC, bid_placed_at ASC, id ASC LIMIT 20`);
for (const r of rows) console.log(String(r.product_name).padEnd(18), "| placed:", JSON.stringify(r.bid_placed_at), "| created:", JSON.stringify(r.created_at));
process.exit(0);
