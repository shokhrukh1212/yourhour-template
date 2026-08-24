import { query } from "./db";
import { SLUG_PATTERN } from "./slug";
import { WALL_PAGE_SIZE, WALL_RANK_SAMPLE } from "./wall-rank";
import { normalizeWallDomain } from "./wall-url";
import type { Slot } from "./slots";

export type WallEntry = {
  id: string;
  amount_paid: number;
  display_name: string | null;
  url: string | null;
  pitch: string | null;
  image_url: string | null;
  slug: string | null;
  total_clicks: number;
  created_at: Date;
};

export type WallEntryDetail = WallEntry & { rank: number; slots: Slot[] };

export type TopClickedProduct = Pick<
  WallEntry,
  "id" | "display_name" | "url" | "pitch" | "image_url" | "total_clicks"
> & {
  /** The product's position on the permanent, amount-ranked Wall. */
  rank: number;
};

export type LandingClickProof = {
  topClickedProducts: TopClickedProduct[];
  allTimeClicks: number;
};

export type WallEntryMatch = Pick<WallEntry, "id" | "amount_paid" | "display_name" | "slug"> & {
  rank: number;
};

/**
 * total_clicks splits cleanly by where the click came from: the entry's slot holds the
 * clicks earned live on the homepage, and e.clicks holds the ones earned afterwards from
 * the Wall and the permanent page.
 */
const ENTRY_COLUMNS = `
  e.id::text AS id, e.amount_paid, e.display_name, e.url, e.pitch, e.image_url, e.slug, e.created_at,
  (e.clicks + COALESCE(s.slot_clicks, 0))::int AS total_clicks
`;

const ENTRY_CLICK_JOIN = `
  LEFT JOIN LATERAL (
    SELECT sum(clicks)::int AS slot_clicks FROM slots WHERE wall_entry_id = e.id
  ) s ON true
`;

/** The Wall never resets and is ranked by money, so ties go to whoever paid first. */
const RANK_SORT = `e.amount_paid DESC, e.created_at ASC, e.id ASC`;
const RANK_ORDER = `ORDER BY ${RANK_SORT}`;

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
 * Landing-page social proof from the same cumulative click definition as the Wall.
 *
 * One Wall entry is one product. Its linked slots are placements for that product, so
 * aggregating them before joining keeps multi-hour purchases deduped. The all-time total
 * is returned by the same query as the top three so the header and proof cards cannot
 * silently drift onto different definitions.
 */
export async function getLandingClickProof(): Promise<LandingClickProof> {
  const rows = await query<{
    top_products: TopClickedProduct[];
    all_time_clicks: string;
  }>(
    `WITH slot_click_totals AS (
       SELECT wall_entry_id, sum(clicks)::bigint AS clicks
         FROM slots
        WHERE wall_entry_id IS NOT NULL
        GROUP BY wall_entry_id
     ), ranked_entries AS (
       SELECT e.*,
              row_number() OVER (ORDER BY ${RANK_SORT})::int AS wall_rank
         FROM wall_entries e
     ), valid_products AS (
       SELECT e.id, e.display_name, e.url, e.pitch, e.image_url, e.created_at,
              e.wall_rank,
              (e.clicks::bigint + COALESCE(s.clicks, 0)) AS total_clicks
         FROM ranked_entries e
         LEFT JOIN slot_click_totals s ON s.wall_entry_id = e.id
        WHERE e.display_name IS NOT NULL
          AND btrim(e.display_name) <> ''
          AND e.url IS NOT NULL
          AND btrim(e.url) <> ''
     ), top_products AS (
       SELECT *
         FROM valid_products
        WHERE total_clicks > 0
        ORDER BY total_clicks DESC, wall_rank ASC, created_at ASC, id ASC
        LIMIT 3
     )
     SELECT COALESCE(
              (
                SELECT jsonb_agg(
                         jsonb_build_object(
                           'id', p.id::text,
                           'display_name', p.display_name,
                           'url', p.url,
                           'pitch', p.pitch,
                           'image_url', p.image_url,
                           'total_clicks', p.total_clicks,
                           'rank', p.wall_rank
                         )
                         ORDER BY p.total_clicks DESC, p.wall_rank ASC,
                                  p.created_at ASC, p.id ASC
                       )
                  FROM top_products p
              ),
              '[]'::jsonb
            ) AS top_products,
            COALESCE((SELECT sum(total_clicks) FROM valid_products), 0)::text
              AS all_time_clicks`,
  );

  const row = rows[0];
  return {
    topClickedProducts: row?.top_products ?? [],
    allTimeClicks: Number(row?.all_time_clicks ?? 0),
  };
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
 * Finds the one permanent listing for a submitted product domain. This intentionally
 * happens in application code rather than a URL-shaped SQL comparison: old rows may
 * have any protocol, path or query string, but all of them still identify the same
 * product by hostname.
 */
export async function findWallEntryByUrl(rawUrl: string): Promise<WallEntryMatch | null> {
  const domain = normalizeWallDomain(rawUrl);
  if (!domain) return null;

  const rows = await query<Pick<WallEntry, "id" | "amount_paid" | "display_name" | "slug" | "url">>(
    `SELECT e.id::text AS id, e.amount_paid, e.display_name, e.slug, e.url
       FROM wall_entries e ${RANK_ORDER}`,
  );
  const index = rows.findIndex((entry) => normalizeWallDomain(entry.url) === domain);
  if (index < 0) return null;

  const entry = rows[index];
  return {
    id: entry.id,
    amount_paid: entry.amount_paid,
    display_name: entry.display_name,
    slug: entry.slug,
    rank: index + 1,
  };
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

/**
 * The current rollup for a batch of Wall entries, keyed by id. Same arithmetic as
 * ENTRY_COLUMNS, so a card that refreshes its number after a click never disagrees with
 * the number the next server render puts there.
 */
export async function getWallClickCounts(ids: string[]): Promise<Record<string, number>> {
  const valid = ids.filter((id) => /^\d+$/.test(id));
  if (valid.length === 0) return {};

  const rows = await query<{ id: string; total_clicks: number }>(
    `SELECT e.id::text AS id, (e.clicks + COALESCE(s.slot_clicks, 0))::int AS total_clicks
       FROM wall_entries e ${ENTRY_CLICK_JOIN}
      WHERE e.id = ANY($1::bigint[])`,
    [valid],
  );
  return Object.fromEntries(rows.map((row) => [row.id, row.total_clicks]));
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
