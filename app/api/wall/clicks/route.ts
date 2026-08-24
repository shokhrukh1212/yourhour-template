import { NextResponse } from "next/server";
import { getWallClickCounts } from "@/lib/wall";
import { WALL_PAGE_SIZE } from "@/lib/wall-rank";

export const dynamic = "force-dynamic";

/**
 * The click counts for the entries currently on screen. The Wall calls this straight
 * after somebody opens a tracked link, so the count on the card moves the moment the
 * click is recorded instead of waiting for the next page load.
 */
export async function GET(request: Request) {
  const ids = (new URL(request.url).searchParams.get("ids") ?? "")
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean)
    // One page of cards is the most any caller can legitimately be showing.
    .slice(0, WALL_PAGE_SIZE);

  return NextResponse.json(
    { clicks: await getWallClickCounts(ids) },
    { headers: { "cache-control": "no-store" } },
  );
}
