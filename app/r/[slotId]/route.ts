import { NextResponse } from "next/server";
import { config } from "@/lib/config";
import { query, withTransaction } from "@/lib/db";
import { trackServerEvent } from "@/lib/analytics";
import { hashIp } from "@/lib/click";

export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ slotId: string }> },
) {
  const { slotId } = await params;
  if (!/^\d+$/.test(slotId)) {
    return NextResponse.redirect(new URL("/", config.siteUrl));
  }

  const rows = await query<{ url: string | null }>(
    `SELECT url FROM slots WHERE id = $1`,
    [slotId],
  );
  const url = rows[0]?.url;
  if (!url) return NextResponse.redirect(new URL("/", config.siteUrl));

  const ipHash = hashIp(request);

  try {
    await withTransaction(async (client) => {
      // The primary key does the deduping, so one person refreshing can't inflate
      // the number. The counts are public, so they have to look honest.
      const inserted = await client.query(
        `INSERT INTO clicks (slot_id, ip_hash) VALUES ($1, $2)
         ON CONFLICT (slot_id, ip_hash) DO NOTHING`,
        [slotId, ipHash],
      );
      if (inserted.rowCount) {
        await client.query(`UPDATE slots SET clicks = clicks + 1 WHERE id = $1`, [slotId]);
      }
    });
  } catch (err) {
    // A failed count must never block the visitor from reaching the buyer.
    console.error("click tracking failed", err);
  }

  void trackServerEvent("slot_clicked", { slotId });

  return NextResponse.redirect(url, { status: 302 });
}
