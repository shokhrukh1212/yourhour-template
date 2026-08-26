/**
 * Dumps every table to a timestamped JSON file before a migration.
 *
 * Run this before the leaderboard migration so the guaranteed-click era remains
 * recoverable independently from the in-database audit. It is read-only.
 *
 *   npx tsx --env-file=.env.local scripts/backup-json.ts
 *   npx tsx --env-file=.env.local scripts/backup-json.ts ./backups
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { getPool, query } from "../lib/db";

async function main() {
  const dir = process.argv[2] ?? "backups";
  mkdirSync(dir, { recursive: true });

  const tables = await query<{ table_name: string }>(
    `SELECT table_name FROM information_schema.tables
      WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
      ORDER BY table_name`,
  );

  const dump: Record<string, unknown[]> = {};
  for (const { table_name } of tables) {
    // Identifiers can't be parameterised; the list comes from the catalogue, not input.
    dump[table_name] = await query(`SELECT * FROM "${table_name}"`);
    console.log(`  ${table_name}: ${dump[table_name].length} rows`);
  }

  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const file = join(dir, `yourhour-${stamp}.json`);
  writeFileSync(file, JSON.stringify(dump, null, 2));
  console.log(`\nwrote ${file}`);
  await getPool().end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
