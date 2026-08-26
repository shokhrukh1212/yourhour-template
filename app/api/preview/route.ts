import { NextResponse } from "next/server";
import { recordFunnelEvent } from "@/lib/analytics";
import { fetchUrlMetadata } from "@/lib/metadata";
import { findListingByUrl } from "@/lib/leaderboard";
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
  const existing = await findListingByUrl(check.normalized);

  const token = ownerTokenFromRequest(request);
  // Legacy listings had no owner. Their first paid upgrade claims ownership.
  const owned = Boolean(existing && (!existing.owner_token_hash || ownerHashesMatch(
    existing.owner_token_hash,
    token ? hashOwnerToken(token) : null,
  )));
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
      existing: existing ? { id: existing.id, bidCents: existing.bid_cents } : null,
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
