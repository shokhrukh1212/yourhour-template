import { query } from "./db";

export async function bumpCounter(key: string, by = 1): Promise<number> {
  const rows = await query<{ value: string }>(
    `INSERT INTO counters (key, value) VALUES ($1, $2)
     ON CONFLICT (key) DO UPDATE SET value = counters.value + EXCLUDED.value
     RETURNING value::text AS value`,
    [key, by],
  );
  return Number(rows[0].value);
}

export async function readCounter(key: string): Promise<number> {
  const rows = await query<{ value: string }>(
    `SELECT value::text AS value FROM counters WHERE key = $1`,
    [key],
  );
  return rows[0] ? Number(rows[0].value) : 0;
}

/** 'x_posts:YYYY-MM-DD' in UTC, so the spend cap resets on a fixed daily boundary. */
export function xPostCounterKey(now: Date = new Date()): string {
  return `x_posts:${now.toISOString().slice(0, 10)}`;
}
