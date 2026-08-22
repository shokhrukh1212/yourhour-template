import { query } from "./db";
import { config } from "./config";

export type SlotStatus = "open" | "reserved" | "sold" | "past";

export type Slot = {
  id: string;
  starts_at: Date;
  status: SlotStatus;
  display_name: string | null;
  url: string | null;
  pitch: string | null;
  claim_number: number | null;
  slug: string | null;
  price_paid: number | null;
  clicks: number;
  sold_at: Date | null;
};

const PUBLIC_COLUMNS = `
  id::text AS id, starts_at, status, display_name, url, pitch,
  claim_number, slug, price_paid, clicks, sold_at
`;

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
