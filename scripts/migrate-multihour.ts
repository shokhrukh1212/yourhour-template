import { getPool } from "../lib/db";

/**
 * Additive migration for the multi-hour checkout release. It intentionally avoids the
 * historical cleanup drops in the full schema script, so it is safe to apply to the
 * configured live database as an isolated change.
 */
async function main() {
  const pool = getPool();
  await pool.query(`ALTER TABLE reservations ADD COLUMN IF NOT EXISTS hours integer NOT NULL DEFAULT 1`);
  await pool.query(`ALTER TABLE reservations ADD COLUMN IF NOT EXISTS wall_amount integer`);
  await pool.query(`
    DO $$ BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
         WHERE conname = 'reservations_hours_check'
      ) THEN
        ALTER TABLE reservations
          ADD CONSTRAINT reservations_hours_check CHECK (hours IN (1, 2, 3, 6));
      END IF;
    END $$;
  `);
  console.log("multi-hour fields applied");
  await pool.end();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
