import type { PoolClient } from "pg";
import { HOUR_MS } from "./time";

export const HOMEPAGE_HOURS = [1, 2, 3, 6] as const;
export type HomepageHours = (typeof HOMEPAGE_HOURS)[number];

export type BlockSlot = {
  id: string;
  starts_at: Date;
  status: "open" | "reserved" | "sold" | "past";
};

export function isHomepageHours(value: number): value is HomepageHours {
  return (HOMEPAGE_HOURS as readonly number[]).includes(value);
}

/** Creates any calendar rows a block reaches beyond the currently displayed horizon. */
export async function ensureSlotBlock(
  client: PoolClient,
  start: Date,
  hours: HomepageHours,
) {
  await client.query(
    `INSERT INTO slots (starts_at)
     SELECT $1::timestamptz + (step * interval '1 hour')
       FROM generate_series(0, $2 - 1) AS step
     ON CONFLICT (starts_at) DO NOTHING`,
    [start, hours],
  );
}

/** Reads a consecutive block under the caller's board lock. */
export async function getSlotBlock(
  client: PoolClient,
  start: Date,
  hours: HomepageHours,
  allowedStatuses: readonly BlockSlot["status"][],
): Promise<BlockSlot[] | null> {
  await ensureSlotBlock(client, start, hours);
  const rows = await client.query<BlockSlot>(
    `SELECT id::text AS id, starts_at, status::text AS status
       FROM slots
      WHERE starts_at >= $1
        AND starts_at < $1 + ($2 * interval '1 hour')
      ORDER BY starts_at ASC
      FOR UPDATE`,
    [start, hours],
  );

  if (rows.rows.length !== hours) return null;
  for (let index = 0; index < rows.rows.length; index += 1) {
    const slot = rows.rows[index];
    if (!allowedStatuses.includes(slot.status)) return null;
    if (slot.starts_at.getTime() !== start.getTime() + index * HOUR_MS) return null;
  }
  return rows.rows;
}

/** Finds the next consecutive open block, extending the calendar when all visible hours are taken. */
export async function findFirstOpenSlotBlock(
  client: PoolClient,
  hours: HomepageHours,
  now: Date,
): Promise<BlockSlot[]> {
  const rows = await client.query<BlockSlot>(
    `SELECT id::text AS id, starts_at, status::text AS status
       FROM slots
      WHERE starts_at > $1
      ORDER BY starts_at ASC
      FOR UPDATE`,
    [now],
  );

  let run: BlockSlot[] = [];
  for (const slot of rows.rows) {
    const followsPrevious =
      run.length > 0 && slot.starts_at.getTime() === run[run.length - 1].starts_at.getTime() + HOUR_MS;
    run = slot.status === "open" && (run.length === 0 || followsPrevious) ? [...run, slot] : slot.status === "open" ? [slot] : [];
    if (run.length === hours) return run;
  }

  const lastKnown = rows.rows[rows.rows.length - 1]?.starts_at ?? new Date(now);
  const nextStart = new Date(
    Math.max(lastKnown.getTime(), startOfHour(now).getTime()) + HOUR_MS,
  );
  const created = await getSlotBlock(client, nextStart, hours, ["open"]);
  if (!created) throw new Error("could not create an open hour block");
  return created;
}

function startOfHour(date: Date): Date {
  const next = new Date(date);
  next.setUTCMinutes(0, 0, 0);
  return next;
}
