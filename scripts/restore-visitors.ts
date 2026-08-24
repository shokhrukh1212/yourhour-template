/** Restores the anonymous visitor ledger from a JSON backup produced by backup-json. */
import { readFileSync } from "node:fs";
import { getPool, query } from "../lib/db";

type VisitorRow = {
  id: string;
  first_seen_at: string;
  last_seen_at: string;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function main() {
  const file = process.argv[2];
  if (!file) throw new Error("usage: restore-visitors.ts <backup.json>");
  const backup = JSON.parse(readFileSync(file, "utf8")) as { visitors?: VisitorRow[] };
  const visitors = backup.visitors ?? [];
  if (!visitors.length || visitors.some((visitor) => !UUID.test(visitor.id))) {
    throw new Error("backup has no valid visitor ledger");
  }

  await query(
    `INSERT INTO visitors (id, first_seen_at, last_seen_at)
     SELECT * FROM unnest($1::uuid[], $2::timestamptz[], $3::timestamptz[])
     ON CONFLICT (id) DO UPDATE
       SET first_seen_at = LEAST(visitors.first_seen_at, excluded.first_seen_at),
           last_seen_at = GREATEST(visitors.last_seen_at, excluded.last_seen_at)`,
    [
      visitors.map((visitor) => visitor.id),
      visitors.map((visitor) => visitor.first_seen_at),
      visitors.map((visitor) => visitor.last_seen_at),
    ],
  );
  const total = await query<{ count: string }>(`SELECT count(*)::text AS count FROM visitors`);
  console.log(`restored visitors: ${total[0]?.count ?? 0}`);
  await getPool().end();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
