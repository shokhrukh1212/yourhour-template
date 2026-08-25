import { NextResponse } from "next/server";
import { recordFunnelEvent } from "@/lib/analytics";
import { ensureVisitorId, VISITOR_COOKIE, visitorCookieOptions } from "@/lib/visitor-id";
import { requestAnalyticsContext } from "@/lib/request-context";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  let body: Record<string, unknown>;
  try {
    body = await request.json() as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }
  if (body.event !== "buyer_landing_viewed") {
    return NextResponse.json({ error: "Unsupported event." }, { status: 400 });
  }
  const suppliedId = String(body.eventId ?? "").trim();
  if (!/^[A-Za-z0-9._:-]{8,128}$/.test(suppliedId)) {
    return NextResponse.json({ error: "Invalid event id." }, { status: 400 });
  }
  const visitor = ensureVisitorId(request);
  const attribution = sanitizeAttribution(body.attribution);
  await recordFunnelEvent({
    name: "buyer_landing_viewed",
    idempotencyKey: suppliedId,
    visitorId: visitor.id,
    eventData: { ...attribution, ...requestAnalyticsContext(request) },
  });
  const response = NextResponse.json({ ok: true });
  if (visitor.isNew) response.cookies.set(VISITOR_COOKIE, visitor.id, visitorCookieOptions);
  return response;
}

function sanitizeAttribution(raw: unknown): Record<string, string> {
  if (!raw || typeof raw !== "object") return {};
  const source = raw as Record<string, unknown>;
  const output: Record<string, string> = {};
  for (const key of ["utmSource", "utmMedium", "utmCampaign", "utmContent", "utmTerm", "referrer"] as const) {
    const value = String(source[key] ?? "").trim();
    if (value) output[key] = value.slice(0, key === "referrer" ? 500 : 200);
  }
  return output;
}
