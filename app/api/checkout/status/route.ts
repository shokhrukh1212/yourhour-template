import { NextResponse } from "next/server";
import { query } from "@/lib/db";

export const dynamic = "force-dynamic";

/**
 * Has the webhook for this checkout landed yet?
 *
 * The buyer's slug is only decided inside the sale transaction, so the redirect back
 * from Lemon Squeezy carries the reservation id instead. /success polls this until the
 * sale appears, rather than 404ing on a page that does not exist for another second.
 */
export async function GET(request: Request) {
  const id = new URL(request.url).searchParams.get("r");
  if (!id || !/^[0-9a-f-]{36}$/i.test(id)) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  const rows = await query<{ status: string; slug: string | null }>(
    `SELECT r.status, e.slug
       FROM reservations r
       LEFT JOIN wall_entries e ON e.id = r.wall_entry_id
      WHERE r.id = $1`,
    [id],
  );
  const row = rows[0];
  if (!row) return NextResponse.json({ error: "not found" }, { status: 404 });

  return NextResponse.json(
    { ready: Boolean(row.slug), status: row.status, slug: row.slug },
    { headers: { "cache-control": "no-store" } },
  );
}
