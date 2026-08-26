import { NextResponse } from "next/server";
import { getListingById } from "@/lib/leaderboard";
import { hashIp, isObviousBot, requestUserAgent } from "@/lib/click";
import { config } from "@/lib/config";
import { recordCampaignClick } from "@/lib/delivery";
import { hashOwnerToken, ownerTokenFromRequest } from "@/lib/ownership";
import { ensureVisitorId, VISITOR_COOKIE, visitorCookieOptions } from "@/lib/visitor-id";

export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  if (!/^\d+$/.test(id)) return NextResponse.redirect(new URL("/", config.siteUrl));

  const campaign = await getListingById(id).catch(() => null);
  if (!campaign?.url) return NextResponse.redirect(new URL("/", config.siteUrl));

  const visitor = ensureVisitorId(request);
  let destination = campaign.url;
  try {
    const ownerToken = ownerTokenFromRequest(request);
    const outcome = await recordCampaignClick({
      campaignId: id,
      visitorId: visitor.id,
      ipHash: hashIp(request),
      userAgent: requestUserAgent(request),
      obviousBot: isObviousBot(request),
      ownerTokenHash: ownerToken ? hashOwnerToken(ownerToken) : null,
    });
    destination = outcome.url ?? new URL("/", config.siteUrl).toString();
  } catch (error) {
    console.error("campaign click tracking failed", error);
    // Counting is best-effort; a database problem must not trap a visitor on this site.
  }
  const response = NextResponse.redirect(destination, { status: 302 });
  if (visitor.isNew) response.cookies.set(VISITOR_COOKIE, visitor.id, visitorCookieOptions);
  return response;
}
