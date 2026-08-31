import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import { getVisitorTotal } from "@/lib/visitors";
import { getWatchingNow } from "@/lib/watching";
import { ensureVisitorId, VISITOR_COOKIE, visitorCookieOptions } from "@/lib/visitor-id";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const requestUrl = new URL(request.url);
  const isLocalPreview = requestUrl.hostname === "localhost" || requestUrl.hostname === "127.0.0.1";
  if (requestUrl.searchParams.get("peek") || isLocalPreview) {
    const [visitors, watching] = await Promise.all([getVisitorTotal(), getWatchingNow()]);
    return NextResponse.json(
      { visitors, watching },
      { headers: { "cache-control": "no-store" } },
    );
  }

  const visitor = ensureVisitorId(request);

  await query(
    `INSERT INTO visitors (id) VALUES ($1::uuid)
     ON CONFLICT (id) DO UPDATE SET last_seen_at = now()`,
    [visitor.id],
  );

  const [visitors, watching] = await Promise.all([getVisitorTotal(), getWatchingNow()]);
  const response = NextResponse.json(
    { visitors, watching, visitorId: visitor.id },
    { headers: { "cache-control": "no-store" } },
  );
  if (visitor.isNew) response.cookies.set(VISITOR_COOKIE, visitor.id, visitorCookieOptions);
  return response;
}
