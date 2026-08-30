import { NextResponse } from "next/server";
import { hashIp, isObviousBot, requestUserAgent } from "@/lib/click";
import { config } from "@/lib/config";
import { withTransaction } from "@/lib/db";
import type { SponsorPlacement } from "@/lib/sponsorship-shared";

export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) {
    return NextResponse.redirect(new URL("/", config.siteUrl));
  }
  const requestedPlacement = new URL(request.url).searchParams.get("placement");
  const placement: SponsorPlacement = requestedPlacement === "sponsor_mobile"
    ? "sponsor_mobile"
    : "sponsor_desktop";

  let destination = new URL("/", config.siteUrl).toString();
  try {
    destination = await withTransaction(async (client) => {
      const selected = await client.query<{
        product_url: string;
        status: string;
        ends_at: Date | null;
      }>(
        `SELECT product_url, status, ends_at FROM sponsorships WHERE id = $1 FOR UPDATE`,
        [id],
      );
      const sponsor = selected.rows[0];
      if (!sponsor) return destination;
      const active = sponsor.status === "active"
        && Boolean(sponsor.ends_at && sponsor.ends_at.getTime() > Date.now());
      if (active && !isObviousBot(request)) {
        await client.query(
          `UPDATE sponsorships
              SET click_count = click_count + 1, updated_at = now()
            WHERE id = $1`,
          [id],
        );
        await client.query(
          `INSERT INTO sponsorship_click_events
             (sponsorship_id, placement, ip_hash, user_agent, counted)
           VALUES ($1,$2,$3,$4,true)`,
          [id, placement, hashIp(request), requestUserAgent(request)],
        );
      }
      return sponsor.product_url;
    });
  } catch (error) {
    console.error("sponsorship click tracking failed", error);
    // A tracking failure must never trap a visitor on YourHour.
    const rows = await withTransaction(async (client) => client.query<{ product_url: string }>(
      `SELECT product_url FROM sponsorships WHERE id = $1`,
      [id],
    )).catch(() => null);
    destination = rows?.rows[0]?.product_url ?? destination;
  }
  return NextResponse.redirect(destination, { status: 302 });
}
