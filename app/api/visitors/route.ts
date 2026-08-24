import { randomUUID } from "node:crypto";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { query } from "@/lib/db";

export const dynamic = "force-dynamic";

const VISITOR_COOKIE = "yourhour_visitor";
const ONE_YEAR_SECONDS = 60 * 60 * 24 * 365;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function visitorTotal(): Promise<number> {
  const rows = await query<{ count: string }>(`SELECT count(*)::text AS count FROM visitors`);
  return Number(rows[0]?.count ?? 0);
}

/**
 * Counts one browser once, rather than counting every server render. The identifier is
 * random, HttpOnly, and contains no personal information.
 *
 * `?peek=1` returns the same total without registering anything. The hero polls this
 * so a tab left open keeps showing a live number instead of the count as it stood when
 * the page was rendered -- and so that polling never writes a row per tick.
 */
export async function GET(request: Request) {
  if (new URL(request.url).searchParams.get("peek")) {
    return NextResponse.json(
      { visitors: await visitorTotal() },
      { headers: { "cache-control": "no-store" } },
    );
  }

  const cookieStore = await cookies();
  const existingId = cookieStore.get(VISITOR_COOKIE)?.value;
  const visitorId = existingId && UUID.test(existingId) ? existingId : randomUUID();

  await query(
    `INSERT INTO visitors (id) VALUES ($1::uuid)
     ON CONFLICT (id) DO UPDATE SET last_seen_at = now()`,
    [visitorId],
  );

  // One row per browser per hour. The primary key does the deduping, and this rollup is
  // what lets the honesty block quote a real per-hour number instead of a guess --
  // visitors alone holds a single timestamp per browser and cannot answer that.
  await query(
    `INSERT INTO visit_hours (visitor_id, hour)
     VALUES ($1::uuid, date_trunc('hour', now()))
     ON CONFLICT DO NOTHING`,
    [visitorId],
  );

  const response = NextResponse.json(
    { visitors: await visitorTotal() },
    { headers: { "cache-control": "no-store" } },
  );

  if (visitorId !== existingId) {
    response.cookies.set(VISITOR_COOKIE, visitorId, {
      httpOnly: true,
      maxAge: ONE_YEAR_SECONDS,
      path: "/",
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
    });
  }

  return response;
}
