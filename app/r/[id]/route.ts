import { NextResponse } from "next/server";
import { trackServerEvent } from "@/lib/analytics";
import { getCampaignById } from "@/lib/campaigns";
import { hashIp } from "@/lib/click";
import { config } from "@/lib/config";
import { recordCampaignClick } from "@/lib/delivery";

export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  if (!/^\d+$/.test(id)) return NextResponse.redirect(new URL("/", config.siteUrl));

  const campaign = await getCampaignById(id).catch(() => null);
  if (!campaign?.url) return NextResponse.redirect(new URL("/", config.siteUrl));

  try {
    const bonusRequested = new URL(request.url).searchParams.get("bonus") === "1";
    const outcome = await recordCampaignClick(id, hashIp(request), bonusRequested);
    if (!outcome.url) return NextResponse.redirect(new URL("/", config.siteUrl));
    void trackServerEvent("campaign_clicked", {
      campaignId: id,
      counted: outcome.counted,
      completed: outcome.completed,
      bonus: outcome.bonus,
    });
    return NextResponse.redirect(outcome.url, { status: 302 });
  } catch (error) {
    console.error("campaign click tracking failed", error);
    // Counting is best-effort; a database problem must not trap a visitor on this site.
    return NextResponse.redirect(campaign.url, { status: 302 });
  }
}
