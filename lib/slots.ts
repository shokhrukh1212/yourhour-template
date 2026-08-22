import { query } from "./db";
import { config } from "./config";
import { LIVE_CLAIM_WINDOW_MS } from "./time";

export type SlotStatus = "open" | "reserved" | "sold" | "past";

export type Slot = {
  id: string;
  starts_at: Date;
  status: SlotStatus;
  display_name: string | null;
  url: string | null;
  pitch: string | null;
  x_handle: string | null;
  /** Who paid, when this hour was a gift. The recipient is x_handle. */
  gifter_handle: string | null;
  /** The last day of the standing run this hour belongs to. Null if it is not one. */
  standing_through: Date | null;
  claim_number: number | null;
  slug: string | null;
  price_paid: number | null;
  clicks: number;
  sold_at: Date | null;
};

export type Board = {
  price: number;
  last_sale_at: Date | null;
  last_decay_at: Date;
  /** Consecutive fully-elapsed clock hours with no hour sale. Any sale resets it. */
  silent_hours: number;
  /** The highest P has ever reached. Half of it is the floor, permanently. */
  all_time_high_floor: number;
};

/** Public columns only. buyer_email must never reach the client. */
const PUBLIC_COLUMNS = `
  id::text AS id, starts_at, status, display_name, url, pitch, x_handle, gifter_handle,
  standing_through, claim_number, slug, price_paid, clicks, sold_at
`;

export async function getBoard(): Promise<Board> {
  const rows = await query<Board>(
    `SELECT price, last_sale_at, last_decay_at, silent_hours, all_time_high_floor
       FROM board WHERE id = 1`,
  );
  if (!rows[0]) throw new Error("board row is missing; run scripts/migrate.ts");
  return rows[0];
}

/** The hour currently on screen. May be sold (show the pitch) or open (show the offer). */
export async function getLiveSlot(): Promise<Slot | null> {
  const rows = await query<Slot>(
    `SELECT ${PUBLIC_COLUMNS} FROM slots
      WHERE starts_at = date_trunc('hour', now())
      LIMIT 1`,
  );
  return rows[0] ?? null;
}

/** Future booked hours reveal their product links, but the pitch stays for the live hour. */
export async function getUpcomingSlots(): Promise<Slot[]> {
  const rows = await query<Slot>(
    `SELECT ${PUBLIC_COLUMNS} FROM slots
      WHERE starts_at > date_trunc('hour', now())
      ORDER BY starts_at ASC
      LIMIT $1`,
    [config.calendarHours],
  );
  return rows.map((slot) =>
    slot.status === "open"
      ? slot
      : { ...slot, pitch: null, price_paid: null },
  );
}

export async function getSlotById(id: string): Promise<Slot | null> {
  if (!/^\d+$/.test(id)) return null;
  const rows = await query<Slot>(
    `SELECT ${PUBLIC_COLUMNS} FROM slots WHERE id = $1`,
    [id],
  );
  return rows[0] ?? null;
}

/**
 * Every hour in the next `days` that is NOT open, as ISO strings.
 *
 * The calendar only reaches 24 hours ahead, but a standing hour needs to know whether
 * the same hour is free on each of the next seven days -- six of which the client
 * cannot see. This is the smallest thing that answers that: a few dozen timestamps,
 * which the form turns into a Set. The server re-checks under the board lock and is
 * what actually decides.
 */
export async function getBookedHoursAhead(days = 7): Promise<string[]> {
  const rows = await query<{ starts_at: Date }>(
    `SELECT starts_at FROM slots
      WHERE status <> 'open'
        AND starts_at >= date_trunc('hour', now())
        AND starts_at < date_trunc('hour', now()) + (($1 * 24) || ' hours')::interval
      ORDER BY starts_at ASC`,
    [days],
  );
  return rows.map((r) => new Date(r.starts_at).toISOString());
}

export async function getNextOpenSlot(): Promise<Slot | null> {
  const rows = await query<Slot>(
    `SELECT ${PUBLIC_COLUMNS} FROM slots
      WHERE status = 'open' AND starts_at > now()
      ORDER BY starts_at ASC
      LIMIT 1`,
  );
  return rows[0] ?? null;
}

export async function getVisitsTotal(): Promise<number> {
  const rows = await query<{ count: string }>(`SELECT count(*)::text AS count FROM visitors`);
  return Number(rows[0]?.count ?? 0);
}

/**
 * The hour in progress, but only while it can still be sold. Returned separately from
 * getUpcomingSlots because that query deliberately starts at the next hour.
 */
export async function getClaimableLiveSlot(): Promise<Slot | null> {
  const rows = await query<Slot>(
    `SELECT ${PUBLIC_COLUMNS} FROM slots
      WHERE starts_at = date_trunc('hour', now())
        AND status = 'open'
        AND now() < starts_at + ($1 || ' milliseconds')::interval
      LIMIT 1`,
    [LIVE_CLAIM_WINDOW_MS],
  );
  return rows[0] ?? null;
}

export type EncoreBuyer = {
  slotId: string;
  displayName: string;
  url: string | null;
  pitch: string | null;
  totalClicks: number;
};

/**
 * The past buyer with the most clicks to their name, who gets an unclaimed hour for
 * free. Ranked per buyer rather than per hour, so somebody with three solid hours beats
 * somebody with one lucky one. buyer_email is the identity and never leaves the server.
 */
export async function getEncoreBuyer(): Promise<EncoreBuyer | null> {
  const rows = await query<{
    slot_id: string;
    display_name: string;
    url: string | null;
    pitch: string | null;
    total_clicks: string;
  }>(
    `WITH ranked AS (
       SELECT buyer_email,
              sum(clicks + encore_clicks) AS total_clicks
         FROM slots
        WHERE status = 'past' AND display_name IS NOT NULL AND buyer_email IS NOT NULL
        GROUP BY buyer_email
        ORDER BY total_clicks DESC, max(sold_at) DESC
        LIMIT 1
     )
     SELECT s.id::text AS slot_id, s.display_name, s.url, s.pitch,
            r.total_clicks::text AS total_clicks
       FROM ranked r
       JOIN slots s ON s.buyer_email = r.buyer_email
      WHERE s.status = 'past' AND s.display_name IS NOT NULL
      ORDER BY s.clicks + s.encore_clicks DESC, s.sold_at DESC
      LIMIT 1`,
  );
  const row = rows[0];
  if (!row) return null;
  return {
    slotId: row.slot_id,
    displayName: row.display_name,
    url: row.url,
    pitch: row.pitch,
    totalClicks: Number(row.total_clicks),
  };
}

/**
 * Average unique visitors per hour over the last week, for the honesty block. Averaged
 * across every hour in the window including the dead ones, because rounding those away
 * would be exactly the flattery the block exists to avoid.
 */
export async function getVisitorsPerHour(): Promise<number> {
  const rows = await query<{ per_hour: string }>(
    `WITH window_start AS (
       SELECT greatest(
                date_trunc('hour', now()) - interval '7 days',
                COALESCE((SELECT min(hour) FROM visit_hours), date_trunc('hour', now()))
              ) AS from_hour
     )
     SELECT COALESCE(
              round(
                count(*)::numeric / GREATEST(
                  EXTRACT(epoch FROM date_trunc('hour', now()) - w.from_hour) / 3600,
                  1
                )
              ),
              0
            )::text AS per_hour
       FROM window_start w
       LEFT JOIN visit_hours v ON v.hour >= w.from_hour
      GROUP BY w.from_hour`,
  );
  return Number(rows[0]?.per_hour ?? 0);
}
