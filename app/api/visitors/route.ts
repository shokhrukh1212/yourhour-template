import { randomUUID } from "node:crypto";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import { getVisitorTotal } from "@/lib/visitors";

export const dynamic = "force-dynamic";

const VISITOR_COOKIE = "yourhour_visitor";
const ONE_YEAR_SECONDS = 60 * 60 * 24 * 365;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(request: Request) {
  if (new URL(request.url).searchParams.get("peek")) {
    return NextResponse.json(
      { visitors: await getVisitorTotal() },
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

  const response = NextResponse.json(
    { visitors: await getVisitorTotal() },
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
