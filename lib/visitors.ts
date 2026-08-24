import { query } from "./db";

export async function getVisitorTotal(): Promise<number> {
  const rows = await query<{ count: string }>(
    `SELECT count(*)::text AS count FROM visitors`,
  );
  return Number(rows[0]?.count ?? 0);
}
