import { NextResponse } from "next/server";
import { query } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const id = new URL(request.url).searchParams.get("id");
  if (!id || !/^[0-9a-f-]{36}$/i.test(id)) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  const rows = await query<{
    status: string;
    position: number;
    product_name: string;
    starts_at: Date | null;
    ends_at: Date | null;
  }>(
    `SELECT status, position, product_name, starts_at, ends_at
       FROM sponsorships WHERE id = $1`,
    [id],
  );
  const row = rows[0];
  if (!row) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json(
    {
      ready: row.status === "active",
      status: row.status,
      position: row.position,
      productName: row.product_name,
      startsAt: row.starts_at?.toISOString() ?? null,
      endsAt: row.ends_at?.toISOString() ?? null,
    },
    { headers: { "cache-control": "no-store" } },
  );
}
