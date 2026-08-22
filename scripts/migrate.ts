import { readFileSync } from "node:fs";
import { join } from "node:path";
import { config } from "../lib/config";
import { formatPrice } from "../lib/pricing";
import { getPool, query } from "../lib/db";
import { assignMissingSlugs } from "../lib/slug-backfill";

async function main() {
  const sql = readFileSync(join(process.cwd(), "lib", "schema.sql"), "utf8");
  await getPool().query(sql);
  console.log("schema applied");

  const existing = await query<{ price: number }>("SELECT price FROM board WHERE id = 1");
  if (existing.length === 0) {
    await query(
      `INSERT INTO board (id, price, last_sale_at, last_decay_at)
       VALUES (1, $1, NULL, date_trunc('hour', now()))`,
      [config.boardStartPrice],
    );
    console.log(`board seeded at ${formatPrice(config.boardStartPrice)}`);
  } else {
    console.log(`board already exists at ${formatPrice(existing[0].price)}`);
  }

  const backfilled = await assignMissingSlugs();
  if (backfilled > 0) console.log(`slugs backfilled: ${backfilled}`);

  const tables = await query<{ table_name: string }>(
    `SELECT table_name FROM information_schema.tables
     WHERE table_schema = 'public' ORDER BY table_name`,
  );
  console.log("tables:", tables.map((t) => t.table_name).join(", "));
  await getPool().end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
