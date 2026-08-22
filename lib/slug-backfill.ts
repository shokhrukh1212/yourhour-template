import { query } from "./db";
import { firstFreeSlug, slugify } from "./slug";

/**
 * Gives a slug to every Wall entry that lacks one. Slugs are normally assigned inside the
 * sale transaction, so this only matters for rows created another way: hours sold before
 * the column existed, entries created by the schema backfill from slugless legacy slots,
 * and seeded demo data.
 *
 * Ordered oldest first so the earliest buyer of a name keeps the bare slug and later
 * ones take the -2, -3 suffixes.
 */
export async function assignMissingSlugs(): Promise<number> {
  const rows = await query<{ id: string; display_name: string | null }>(
    `SELECT id::text AS id, display_name FROM wall_entries
      WHERE slug IS NULL AND display_name IS NOT NULL
      ORDER BY created_at ASC, id ASC`,
  );
  if (rows.length === 0) return 0;

  const taken = new Set(
    (
      await query<{ slug: string }>(
        `SELECT slug FROM wall_entries WHERE slug IS NOT NULL`,
      )
    ).map((r) => r.slug),
  );

  for (const row of rows) {
    const slug = firstFreeSlug(slugify(row.display_name ?? ""), taken);
    taken.add(slug);
    await query(`UPDATE wall_entries SET slug = $1 WHERE id = $2`, [slug, row.id]);
  }
  return rows.length;
}
