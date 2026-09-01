import { query } from "./db";
import { normalizeWallDomain } from "./wall-url";

export const LEADERBOARD_INITIAL_SIZE = 5;
export const LEADERBOARD_PAGE_SIZE = 20;

export type Listing = {
  id: string;
  slug: string;
  url: string;
  normalized_domain: string;
  product_name: string;
  pitch: string | null;
  icon_url: string | null;
  bid_cents: number;
  verified_clicks: number;
  bid_placed_at: Date;
  created_at: Date;
  /** When money actually landed. See `paid_at` in COLUMNS. */
  paid_at: Date;
  owner_token_hash: string | null;
};

export type PublicListing = Omit<Listing, "owner_token_hash"> & { rank: number };

// `bid_placed_at` is the tie-break sort key, not a clock: the leaderboard migration
// backfilled pre-migration rows with synthetic year-2000 stamps to freeze their old
// order inside rounded price ties. Those rows were paid for at `created_at`; a later
// re-bid moves `bid_placed_at` to now(). The greater of the two is the real payment.
const COLUMNS = `
  id::text AS id, slug, url, normalized_domain, product_name, pitch, icon_url,
  bid_cents, verified_clicks, bid_placed_at, created_at,
  GREATEST(bid_placed_at, created_at) AS paid_at, owner_token_hash
`;
const ORDER = `bid_cents DESC, bid_placed_at ASC, id ASC`;

function publicListing(listing: Listing, rank: number): PublicListing {
  const value = { ...listing } as Partial<Listing>;
  delete value.owner_token_hash;
  return { ...(value as Omit<Listing, "owner_token_hash">), rank };
}

export async function getTopListing(): Promise<PublicListing | null> {
  const rows = await query<Listing>(`SELECT ${COLUMNS} FROM campaigns ORDER BY ${ORDER} LIMIT 1`);
  return rows[0] ? publicListing(rows[0], 1) : null;
}

export async function getListingById(id: string): Promise<Listing | null> {
  if (!/^\d+$/.test(id)) return null;
  const rows = await query<Listing>(`SELECT ${COLUMNS} FROM campaigns WHERE id = $1`, [id]);
  return rows[0] ?? null;
}

export async function getListingBySlug(slug: string): Promise<Listing | null> {
  const rows = await query<Listing>(`SELECT ${COLUMNS} FROM campaigns WHERE slug = $1 LIMIT 1`, [slug]);
  return rows[0] ?? null;
}

export async function findListingByUrl(rawUrl: string): Promise<Listing | null> {
  const domain = normalizeWallDomain(rawUrl);
  if (!domain) return null;
  const rows = await query<Listing>(`SELECT ${COLUMNS} FROM campaigns WHERE normalized_domain = $1 LIMIT 1`, [domain]);
  return rows[0] ?? null;
}

export async function getLeaderboard(limit = LEADERBOARD_INITIAL_SIZE, offset = 0): Promise<PublicListing[]> {
  const rows = await query<Listing>(
    `SELECT ${COLUMNS} FROM campaigns ORDER BY ${ORDER} LIMIT $1 OFFSET $2`,
    [limit, offset],
  );
  return rows.map((row, index) => publicListing(row, offset + index + 1));
}

export async function getAllBidCents(): Promise<number[]> {
  const rows = await query<{ bid_cents: number }>(`SELECT bid_cents FROM campaigns`);
  return rows.map((row) => row.bid_cents);
}

export async function getLeaderboardSummary(): Promise<{ count: number; clicks: number }> {
  const rows = await query<{ count: string; clicks: string }>(
    `SELECT count(*)::text AS count, COALESCE(sum(verified_clicks), 0)::text AS clicks FROM campaigns`,
  );
  return { count: Number(rows[0]?.count ?? 0), clicks: Number(rows[0]?.clicks ?? 0) };
}

export async function getActualRank(id: string): Promise<number | null> {
  const rows = await query<{ rank: number }>(
    `SELECT rank FROM (
       SELECT id, row_number() OVER (ORDER BY ${ORDER})::int AS rank FROM campaigns
     ) ranked WHERE id = $1`,
    [id],
  );
  return rows[0]?.rank ?? null;
}
