import { query } from "./db";
import { SLUG_PATTERN } from "./slug";
import { normalizeWallDomain } from "./wall-url";
import { WALL_PAGE_SIZE, WALL_RANK_SAMPLE } from "./wall-rank";

export type CampaignStatus = "queued" | "live" | "delivered";
export type AccountingStatus = "verified" | "manual_reconciled" | "legacy_total_only";

export type Campaign = {
  id: string;
  slug: string;
  url: string;
  product_name: string;
  pitch: string | null;
  icon_url: string | null;
  clicks_purchased: number;
  clicks_delivered: number;
  bonus_clicks: number;
  accounting_status: AccountingStatus;
  purchased_clicks: number | null;
  guaranteed_clicks_delivered: number | null;
  bonus_clicks_delivered: number;
  historical_clicks_delivered: number;
  bonus_round_clicks_delivered: number;
  total_clicks_delivered: number;
  bonus_click_cap: number | null;
  clicks_refunded: number;
  amount_paid_cents: number;
  priority_cents: number;
  status: CampaignStatus;
  owner_token_hash: string | null;
  created_at: Date;
  started_at: Date | null;
  delivered_at: Date | null;
};

export type PublicCampaign = Omit<Campaign, "owner_token_hash"> & {
  rank: number;
  queue_position: number | null;
};

export type CampaignProof = Pick<
  Campaign,
  | "id"
  | "slug"
  | "url"
  | "product_name"
  | "pitch"
  | "icon_url"
  | "clicks_purchased"
  | "accounting_status"
  | "purchased_clicks"
  | "guaranteed_clicks_delivered"
  | "bonus_clicks_delivered"
  | "historical_clicks_delivered"
  | "bonus_round_clicks_delivered"
  | "total_clicks_delivered"
  | "amount_paid_cents"
  | "status"
  | "started_at"
  | "delivered_at"
> & { rank: number };

export function stripCampaignOwner(campaign: Campaign): Omit<Campaign, "owner_token_hash"> {
  const publicCampaign = { ...campaign } as Partial<Campaign>;
  delete publicCampaign.owner_token_hash;
  return publicCampaign as Omit<Campaign, "owner_token_hash">;
}

const COLUMNS = `
  id::text AS id, slug, url, product_name, pitch, icon_url,
  clicks_purchased, clicks_delivered, bonus_clicks, bonus_click_cap, clicks_refunded,
  accounting_status, purchased_clicks, guaranteed_clicks_delivered,
  bonus_clicks_delivered, historical_clicks_delivered,
  bonus_round_clicks_delivered, total_clicks_delivered,
  amount_paid_cents, priority_cents, status::text AS status,
  owner_token_hash, created_at, started_at, delivered_at
`;

const RANK_ORDER = `amount_paid_cents DESC, created_at ASC, id ASC`;
const QUEUE_ORDER = `priority_cents DESC, created_at ASC, id ASC`;

export async function getLiveCampaign(): Promise<Campaign | null> {
  const rows = await query<Campaign>(`SELECT ${COLUMNS} FROM campaigns WHERE status = 'live' LIMIT 1`);
  return rows[0] ?? null;
}

export async function getBonusCampaign(): Promise<Campaign | null> {
  const rows = await query<Campaign>(
    `SELECT ${COLUMNS}
       FROM campaigns
      WHERE status = 'delivered'
        AND (bonus_click_cap IS NOT NULL OR COALESCE(purchased_clicks, 0) > 0)
        AND bonus_round_clicks_delivered < COALESCE(bonus_click_cap, floor(COALESCE(purchased_clicks, 0) * 0.5)::int)
        AND NOT EXISTS (SELECT 1 FROM campaigns WHERE status IN ('live','queued'))
      ORDER BY total_clicks_delivered DESC, amount_paid_cents DESC, created_at ASC, id ASC
      LIMIT 1`,
  );
  return rows[0] ?? null;
}

export async function getWaitingCampaigns(): Promise<Campaign[]> {
  return query<Campaign>(
    `SELECT ${COLUMNS} FROM campaigns WHERE status = 'queued' ORDER BY ${QUEUE_ORDER}`,
  );
}

export async function getQueueWithLive(): Promise<Campaign[]> {
  return query<Campaign>(
    `SELECT ${COLUMNS}
       FROM campaigns
      WHERE status IN ('live','queued')
      ORDER BY CASE WHEN status = 'live' THEN 0 ELSE 1 END,
               priority_cents DESC, created_at ASC, id ASC`,
  );
}

export async function getCampaignById(id: string): Promise<Campaign | null> {
  if (!/^\d+$/.test(id)) return null;
  const rows = await query<Campaign>(`SELECT ${COLUMNS} FROM campaigns WHERE id = $1`, [id]);
  return rows[0] ?? null;
}

export async function getCampaignBySlug(slug: string): Promise<PublicCampaign | null> {
  if (!SLUG_PATTERN.test(slug)) return null;
  const rows = await query<Campaign>(`SELECT ${COLUMNS} FROM campaigns WHERE slug = $1`, [slug]);
  const campaign = rows[0];
  if (!campaign) return null;
  const [rank, queuePosition] = await Promise.all([
    getRank(campaign.id, campaign.amount_paid_cents, campaign.created_at),
    getQueuePosition(campaign.id),
  ]);
  return { ...stripCampaignOwner(campaign), rank, queue_position: queuePosition };
}

export async function findCampaignByUrl(rawUrl: string): Promise<PublicCampaign | null> {
  const domain = normalizeWallDomain(rawUrl);
  if (!domain) return null;
  const rows = await query<Campaign>(`SELECT ${COLUMNS} FROM campaigns ORDER BY ${RANK_ORDER}`);
  const campaign = rows.find((row) => normalizeWallDomain(row.url) === domain);
  if (!campaign) return null;
  const [rank, queuePosition] = await Promise.all([
    getRank(campaign.id, campaign.amount_paid_cents, campaign.created_at),
    getQueuePosition(campaign.id),
  ]);
  return { ...stripCampaignOwner(campaign), rank, queue_position: queuePosition };
}

export async function campaignNameIsTaken(name: string, exceptId?: string): Promise<boolean> {
  const rows = await query<{ id: string }>(
    `SELECT id::text AS id FROM campaigns
      WHERE lower(product_name) = lower($1)
        AND ($2::bigint IS NULL OR id <> $2::bigint)
      LIMIT 1`,
    [name, exceptId ?? null],
  );
  return rows.length > 0;
}

export async function getLeaderboardPage(
  limit = WALL_PAGE_SIZE,
  offset = 0,
): Promise<PublicCampaign[]> {
  const rows = await query<Campaign>(
    `SELECT ${COLUMNS} FROM campaigns ORDER BY ${RANK_ORDER} LIMIT $1 OFFSET $2`,
    [limit, offset],
  );
  const queue = await getQueuePositionMap();
  return rows.map((campaign, index) => {
    return {
      ...stripCampaignOwner(campaign),
      rank: offset + index + 1,
      queue_position: queue[campaign.id] ?? null,
    };
  });
}

export async function getCampaignCount(): Promise<number> {
  const rows = await query<{ count: string }>(`SELECT count(*)::text AS count FROM campaigns`);
  return Number(rows[0]?.count ?? 0);
}

export async function getOwnedCampaignIds(ownerHash: string | null): Promise<string[]> {
  if (!ownerHash) return [];
  const rows = await query<{ id: string }>(
    `SELECT id::text AS id FROM campaigns WHERE owner_token_hash = $1`,
    [ownerHash],
  );
  return rows.map((row) => row.id);
}

export async function getCampaignAmounts(cap = WALL_RANK_SAMPLE): Promise<number[]> {
  const rows = await query<{ amount_paid_cents: number }>(
    `SELECT amount_paid_cents FROM campaigns ORDER BY ${RANK_ORDER} LIMIT $1`,
    [cap],
  );
  return rows.map((row) => row.amount_paid_cents);
}

export async function getDeliveredProof(): Promise<CampaignProof[]> {
  return query<CampaignProof>(
    `WITH ranked AS (
       SELECT c.*, row_number() OVER (ORDER BY ${RANK_ORDER})::int AS rank
         FROM campaigns c
     )
     SELECT id::text AS id, slug, url, product_name, pitch, icon_url,
            clicks_purchased, accounting_status, purchased_clicks,
            guaranteed_clicks_delivered, bonus_clicks_delivered,
            historical_clicks_delivered, bonus_round_clicks_delivered,
            total_clicks_delivered, amount_paid_cents,
            status::text AS status, started_at, delivered_at, rank
       FROM ranked
      WHERE status = 'delivered'
        AND total_clicks_delivered > 0
      ORDER BY total_clicks_delivered DESC, rank ASC, created_at ASC, id ASC
      LIMIT 3`,
  );
}

export async function getDeliveredTotal(): Promise<number> {
  const rows = await query<{ total: string }>(
    `SELECT COALESCE(sum(total_clicks_delivered), 0)::text AS total FROM campaigns`,
  );
  return Number(rows[0]?.total ?? 0);
}

export async function getDeliveredLast24h(): Promise<number> {
  const rows = await query<{ total: string }>(
    `SELECT count(*)::text AS total
       FROM campaign_clicks
      WHERE created_at >= now() - interval '24 hours'`,
  );
  return Number(rows[0]?.total ?? 0);
}

export async function getRollingClicksPerHour(): Promise<number> {
  const rows = await query<{ per_hour: string }>(
    `SELECT (count(*)::numeric / 48)::text AS per_hour
       FROM campaign_clicks
      WHERE created_at >= now() - interval '48 hours' AND NOT is_bonus`,
  );
  return Number(rows[0]?.per_hour ?? 0);
}

export async function getSiteCapacity(): Promise<{
  maxOutstanding: number;
  outstanding: number;
}> {
  const rows = await query<{ max_outstanding: number; outstanding: string }>(
    `SELECT sc.max_outstanding_clicks AS max_outstanding,
            COALESCE((SELECT sum(purchased_clicks - guaranteed_clicks_delivered - clicks_refunded)
                        FROM campaigns
                       WHERE status IN ('queued','live')
                         AND accounting_status IN ('verified','manual_reconciled')), 0)::text AS outstanding
       FROM site_config sc WHERE singleton = true`,
  );
  return {
    maxOutstanding: rows[0]?.max_outstanding ?? 250,
    outstanding: Number(rows[0]?.outstanding ?? 0),
  };
}

export async function getQueuePosition(campaignId: string): Promise<number | null> {
  return (await getQueuePositionMap())[campaignId] ?? null;
}

async function getQueuePositionMap(): Promise<Record<string, number>> {
  const rows = await query<{ id: string; position: number }>(
    `SELECT id::text AS id,
            row_number() OVER (
              ORDER BY CASE WHEN status = 'live' THEN 0 ELSE 1 END,
                       priority_cents DESC, created_at ASC, id ASC
            )::int AS position
       FROM campaigns WHERE status IN ('live','queued')`,
  );
  return Object.fromEntries(rows.map((row) => [row.id, row.position]));
}

async function getRank(id: string, amount: number, createdAt: Date): Promise<number> {
  const rows = await query<{ ahead: string }>(
    `SELECT count(*)::text AS ahead FROM campaigns
      WHERE amount_paid_cents > $1
         OR (amount_paid_cents = $1 AND (created_at, id) < ($2::timestamptz, $3::bigint))`,
    [amount, createdAt, id],
  );
  return Number(rows[0]?.ahead ?? 0) + 1;
}

export function remainingClicks(campaign: Pick<Campaign, "purchased_clicks" | "guaranteed_clicks_delivered" | "clicks_refunded">): number {
  if (campaign.purchased_clicks === null || campaign.guaranteed_clicks_delivered === null) return 0;
  return Math.max(0, campaign.purchased_clicks - campaign.guaranteed_clicks_delivered - campaign.clicks_refunded);
}

export function estimateQueue(queue: Campaign[], perHour: number): Record<string, { start: number | null; complete: number | null }> {
  let ahead = 0;
  const estimates: Record<string, { start: number | null; complete: number | null }> = {};
  for (const campaign of queue) {
    const own = remainingClicks(campaign);
    estimates[campaign.id] = perHour > 0
      ? { start: ahead / perHour, complete: (ahead + own) / perHour }
      : { start: null, complete: null };
    ahead += own;
  }
  return estimates;
}

export function formatEta(hours: number | null, prefix = "~"): string {
  if (hours === null || !Number.isFinite(hours)) return "—";
  if (hours < 24) return `${prefix}${Math.max(1, Math.round(hours))}h`;
  const days = Math.max(1, Math.round(hours / 24));
  return `${prefix}${days} ${days === 1 ? "day" : "days"}`;
}

export function formatDeliveryDuration(startedAt: Date | null, deliveredAt: Date | null): string | null {
  if (!startedAt || !deliveredAt) return null;
  return formatEta(Math.max(0, deliveredAt.getTime() - startedAt.getTime()) / 3_600_000, "in ");
}
