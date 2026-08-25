import { NextResponse } from "next/server";
import { recordFunnelEvent } from "@/lib/analytics";
import { fetchUrlMetadata } from "@/lib/metadata";
import { campaignNameIsTaken, findCampaignByUrl, getCampaignById } from "@/lib/campaigns";
import { hashOwnerToken, ownerHashesMatch, ownerTokenFromRequest } from "@/lib/ownership";
import { checkProductUrl } from "@/lib/validate";
import { ensureVisitorId, VISITOR_COOKIE, visitorCookieOptions } from "@/lib/visitor-id";
import { requestAnalyticsContext } from "@/lib/request-context";

export const dynamic = "force-dynamic";

/**
 * What the claim panel's spinner waits on: the product name and pitch pulled from the
 * buyer's own page, before any money is involved.
 *
 * Advisory only. /api/checkout runs the same validation again under the board lock,
 * because two buyers racing on the same name must not both get through.
 */
export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }

  const raw = (body ?? {}) as Record<string, unknown>;
  const check = checkProductUrl(String(raw.url ?? ""));
  if (!check.ok) return NextResponse.json({ error: check.error }, { status: 400 });
  const visitor = ensureVisitorId(request);
  const suppliedActionId = String(raw.actionId ?? "").trim();
  const actionId = /^[A-Za-z0-9._:-]{8,128}$/.test(suppliedActionId)
    ? suppliedActionId
    : crypto.randomUUID();
  const attribution = sanitizeEventAttribution(raw.attribution);
  const requestContext = requestAnalyticsContext(request);
  await recordFunnelEvent({
    name: "product_url_submitted",
    idempotencyKey: actionId,
    visitorId: visitor.id,
    eventData: { productUrl: check.normalized, ...attribution, ...requestContext },
  });

  const meta = await fetchUrlMetadata(check.normalized);
  const existing = await findCampaignByUrl(check.normalized);

  // Only worth blocking on a name we actually read. A hostname guess colliding is not
  // the buyer's fault, and they get editable fields to fix it.
  if (!existing && meta.scraped && (await campaignNameIsTaken(meta.productName))) {
    return NextResponse.json(
      { error: "Someone is already listed as that product." },
      { status: 409 },
    );
  }

  const token = ownerTokenFromRequest(request);
  const protectedCampaign = existing ? await getCampaignById(existing.id) : null;
  const owned = ownerHashesMatch(
    protectedCampaign?.owner_token_hash ?? null,
    token ? hashOwnerToken(token) : null,
  );
  await recordFunnelEvent({
    name: "claim_opened",
    idempotencyKey: actionId,
    visitorId: visitor.id,
    campaignId: existing?.id ?? null,
    eventData: { productUrl: check.normalized, existingCampaign: Boolean(existing), ...attribution, ...requestContext },
  });
  const response = NextResponse.json(
    {
      url: check.normalized,
      productName: meta.productName,
      pitch: meta.pitch,
      imageUrl: meta.imageUrl,
      scraped: meta.scraped,
      existing,
      owned,
    },
    { headers: { "cache-control": "no-store" } },
  );
  if (visitor.isNew) response.cookies.set(VISITOR_COOKIE, visitor.id, visitorCookieOptions);
  return response;
}

function sanitizeEventAttribution(raw: unknown): Record<string, string> {
  if (!raw || typeof raw !== "object") return {};
  const source = raw as Record<string, unknown>;
  const output: Record<string, string> = {};
  for (const key of ["utmSource", "utmMedium", "utmCampaign", "utmContent", "utmTerm", "referrer"] as const) {
    const value = String(source[key] ?? "").trim();
    if (value) output[key] = value.slice(0, key === "referrer" ? 500 : 200);
  }
  return output;
}
