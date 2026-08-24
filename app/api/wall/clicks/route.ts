import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import { WALL_PAGE_SIZE } from "@/lib/wall-rank";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const ids = (new URL(request.url).searchParams.get("ids") ?? "")
    .split(",")
    .map((id) => id.trim())
    .filter((id) => /^\d+$/.test(id))
    .slice(0, WALL_PAGE_SIZE + 40);
  if (!ids.length) return NextResponse.json({ clicks: {}, bonusClicks: {} });
  const rows = await query<{ id: string; clicks_delivered: number; bonus_clicks: number }>(
    `SELECT id::text AS id, clicks_delivered, bonus_clicks FROM campaigns WHERE id = ANY($1::bigint[])`,
    [ids],
  );
  return NextResponse.json(
    {
      clicks: Object.fromEntries(rows.map((row) => [row.id, row.clicks_delivered])),
      bonusClicks: Object.fromEntries(rows.map((row) => [row.id, row.bonus_clicks])),
    },
    { headers: { "cache-control": "no-store" } },
  );
}
