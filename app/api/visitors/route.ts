import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import { getVisitorTotal } from "@/lib/visitors";
import { ensureVisitorId, VISITOR_COOKIE, visitorCookieOptions } from "@/lib/visitor-id";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  if (new URL(request.url).searchParams.get("peek")) {
    return NextResponse.json(
      { visitors: await getVisitorTotal() },
      { headers: { "cache-control": "no-store" } },
    );
  }

  const visitor = ensureVisitorId(request);

  await query(
    `INSERT INTO visitors (id) VALUES ($1::uuid)
     ON CONFLICT (id) DO UPDATE SET last_seen_at = now()`,
    [visitor.id],
  );

  const response = NextResponse.json(
    { visitors: await getVisitorTotal(), visitorId: visitor.id },
    { headers: { "cache-control": "no-store" } },
  );
  if (visitor.isNew) response.cookies.set(VISITOR_COOKIE, visitor.id, visitorCookieOptions);
  return response;
}
