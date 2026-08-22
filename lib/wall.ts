import { query } from "./db";
import { SLUG_PATTERN } from "./slug";
import { WALL_PAGE_SIZE, WALL_RANK_SAMPLE } from "./wall-rank";
import type { Slot } from "./slots";

export type WallEntry = {
  id: string;
  amount_paid: number;
  display_name: string | null;
  url: string | null;
  pitch: string | null;
  slug: string | null;
  total_clicks: number;
  created_at: Date;
};

export type WallEntryDetail = WallEntry & { rank: number; slots: Slot[] };

/**
 * total_clicks splits cleanly by where the click came from: the entry's slot holds the
 * clicks earned live on the homepage, and e.clicks holds the ones earned afterwards from
 * the Wall and the permanent page.
 */
const ENTRY_COLUMNS = `
  e.id::text AS id, e.amount_paid, e.display_name, e.url, e.pitch, e.slug, e.created_at,
  (e.clicks + COALESCE(s.slot_clicks, 0))::int AS total_clicks
`;

const ENTRY_CLICK_JOIN = `
  LEFT JOIN LATERAL (
    SELECT sum(clicks)::int AS slot_clicks FROM slots WHERE wall_entry_id = e.id
  ) s ON true
`;

/** The Wall never resets and is ranked by money, so ties go to whoever paid first. */
const RANK_ORDER = `ORDER BY e.amount_paid DESC, e.created_at ASC, e.id ASC`;

export async function getWallPage(
  limit = WALL_PAGE_SIZE,
  offset = 0,
): Promise<WallEntry[]> {
  return query<WallEntry>(
    `SELECT ${ENTRY_COLUMNS} FROM wall_entries e ${ENTRY_CLICK_JOIN}
      ${RANK_ORDER} LIMIT $1 OFFSET $2`,
    [limit, offset],
  );
}

export async function getWallCount(): Promise<number> {
  const rows = await query<{ count: string }>(
    `SELECT count(*)::text AS count FROM wall_entries`,
  );
  return Number(rows[0]?.count ?? 0);
}

/**
 * The amounts already on the Wall, descending, so the checkout form can price a rank on
 * every keystroke without a round trip. Capped: past a few hundred entries the exact
 * rank stops being the thing anyone is buying.
 */
export async function getWallAmounts(cap = WALL_RANK_SAMPLE): Promise<number[]> {
  const rows = await query<{ amount_paid: number }>(
    `SELECT amount_paid FROM wall_entries
      ORDER BY amount_paid DESC, created_at ASC LIMIT $1`,
    [cap],
  );
  return rows.map((r) => r.amount_paid);
}

/**
 * The highest amount anyone has paid, or null on an empty Wall. This is the one input
 * to what a spot costs -- see numberOnePrice in lib/pricing.ts.
 */
export async function getWallTopAmount(): Promise<number | null> {
  const rows = await query<{ amount_paid: number }>(
    `SELECT amount_paid FROM wall_entries ORDER BY amount_paid DESC LIMIT 1`,
  );
  return rows[0]?.amount_paid ?? null;
}

/**
 * True when something is already on the Wall under this name. Two products called the
 * same thing make both of them worthless as a permanent listing.
 */
export async function wallNameIsTaken(name: string): Promise<boolean> {
  const rows = await query<{ id: string }>(
    `SELECT id::text AS id FROM wall_entries
      WHERE lower(display_name) = lower($1) LIMIT 1`,
    [name],
  );
  return rows.length > 0;
}

/** The permanent public page. The slug is the identity; the id never appears. */
export async function getWallEntryBySlug(slug: string): Promise<WallEntryDetail | null> {
  if (!SLUG_PATTERN.test(slug)) return null;

  const rows = await query<WallEntry>(
    `SELECT ${ENTRY_COLUMNS} FROM wall_entries e ${ENTRY_CLICK_JOIN} WHERE e.slug = $1`,
    [slug],
  );
  const entry = rows[0];
  if (!entry) return null;

  const [rankRows, slots] = await Promise.all([
    // Counts exactly what RANK_ORDER puts ahead of this entry, so the number on the page
    // always agrees with the position it occupies in the list.
    query<{ ahead: string }>(
      `SELECT count(*)::text AS ahead FROM wall_entries
        WHERE amount_paid > $1
           OR (amount_paid = $1 AND (created_at, id) < ($2::timestamptz, $3::bigint))`,
      [entry.amount_paid, entry.created_at, entry.id],
    ),
    query<Slot>(
      `SELECT id::text AS id, starts_at, status, display_name, url, pitch,
              claim_number, slug, price_paid, clicks, sold_at
         FROM slots WHERE wall_entry_id = $1 ORDER BY starts_at ASC`,
      [entry.id],
    ),
  ]);

  return { ...entry, rank: Number(rankRows[0]?.ahead ?? 0) + 1, slots };
}

/**
 * Every click the buyer of `slotId` has earned: the hours they bought plus the traffic
 * their Wall card and permanent page have sent. This is the same rollup ENTRY_COLUMNS
 * computes, so the homepage hero and the Wall card never show one product two different
 * counts on the same screen.
 *
 * Falls back to the slot's own clicks for a row predating wall_entries.
 */
export async function getBuyerTotalClicks(slotId: string): Promise<number> {
  if (!/^\d+$/.test(slotId)) return 0;
  const rows = await query<{ total: string }>(
    `SELECT COALESCE(
              (SELECT e.clicks
                      + COALESCE((SELECT sum(clicks)::int FROM slots WHERE wall_entry_id = e.id), 0)
                 FROM wall_entries e WHERE e.id = live.wall_entry_id),
              live.clicks
            )::text AS total
       FROM slots live WHERE live.id = $1`,
    [slotId],
  );
  return rows[0] ? Number(rows[0].total) : 0;
}

/** Where an entry's tracked link points. Used by the Wall and the permanent page. */
export async function getWallEntryUrl(entryId: string): Promise<string | null> {
  if (!/^\d+$/.test(entryId)) return null;
  const rows = await query<{ url: string | null }>(
    `SELECT url FROM wall_entries WHERE id = $1`,
    [entryId],
  );
  return rows[0]?.url ?? null;
}
