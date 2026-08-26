import { NextResponse } from "next/server";
import { getLeaderboard, getLeaderboardSummary, LEADERBOARD_PAGE_SIZE } from "@/lib/leaderboard";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const offset = Math.max(0, Math.min(10000, Number(params.get("offset")) || 0));
  const limit = Math.max(1, Math.min(LEADERBOARD_PAGE_SIZE, Number(params.get("limit")) || LEADERBOARD_PAGE_SIZE));
  const [items, summary] = await Promise.all([getLeaderboard(limit, offset), getLeaderboardSummary()]);
  return NextResponse.json({ items, total: summary.count, clicksDelivered: summary.clicks, nextOffset: offset + items.length }, { headers: { "cache-control": "no-store" } });
}
