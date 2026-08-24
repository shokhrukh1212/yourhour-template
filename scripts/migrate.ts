import { readFileSync } from "node:fs";
import { join } from "node:path";
import { getPool, query } from "../lib/db";

async function main() {
  const sql = readFileSync(join(process.cwd(), "lib", "schema.sql"), "utf8");
  await getPool().query(sql);
  console.log("schema applied");

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
