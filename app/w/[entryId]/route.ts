import { NextResponse } from "next/server";
import { config } from "@/lib/config";
import { query, withTransaction } from "@/lib/db";
import { trackServerEvent } from "@/lib/analytics";
import { hashIp } from "@/lib/click";

export const dynamic = "force-dynamic";

/**
 * The counted link for a Wall entry, used by the Wall and by the permanent page. It is
 * the only way a Wall-only spot can be clicked at all, and for an hour entry it keeps
 * traffic arriving long after the hour out of that hour's own number -- so a slot row
 * never stops meaning "clicks earned while it was live".
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ entryId: string }> },
) {
  const { entryId } = await params;
  if (!/^\d+$/.test(entryId)) {
    return NextResponse.redirect(new URL("/", config.siteUrl));
  }

  const rows = await query<{ url: string | null }>(
    `SELECT url FROM wall_entries WHERE id = $1`,
    [entryId],
  );
  const url = rows[0]?.url;
  if (!url) return NextResponse.redirect(new URL("/", config.siteUrl));

  const ipHash = hashIp(request);

  try {
    await withTransaction(async (client) => {
      // The primary key does the deduping, so one person refreshing can't inflate
      // the number. The counts are public, so they have to look honest.
      const inserted = await client.query(
        `INSERT INTO wall_clicks (entry_id, ip_hash) VALUES ($1, $2)
         ON CONFLICT (entry_id, ip_hash) DO NOTHING`,
        [entryId, ipHash],
      );
      if (inserted.rowCount) {
        await client.query(
          `UPDATE wall_entries SET clicks = clicks + 1 WHERE id = $1`,
          [entryId],
        );
      }
    });
  } catch (err) {
    // A failed count must never block the visitor from reaching the buyer.
    console.error("wall click tracking failed", err);
  }

  void trackServerEvent("wall_entry_clicked", { entryId });

  return NextResponse.redirect(url, { status: 302 });
}
